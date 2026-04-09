"""
Transcript graph backbone for phase 1 of the opportunity graph pipeline.

This service turns a raw transcript into:
- transcript segments
- transcript evidence rows
- candidate entities
- draft opportunities linked to evidence
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Iterable
from uuid import uuid4

from app.db.pg_client import PgClient
from app.services.gemini_service import extract_itinerary_blueprint, extract_transcript_opportunities

logger = logging.getLogger(__name__)


@dataclass
class TranscriptSegmentRecord:
    id: str
    start_sec: float
    end_sec: float
    text: str
    source: str = "youtube_caption"


def _split_sentences(transcript: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", transcript.strip())
    return [part.strip() for part in parts if part and part.strip()]


def build_transcript_segments(
    transcript: str,
    duration_seconds: int | None = None,
    *,
    max_sentences_per_segment: int = 2,
) -> list[TranscriptSegmentRecord]:
    """
    Build deterministic transcript segments.

    When source timestamps are unavailable we assign approximate evenly-sized
    time windows so downstream evidence still has a queryable temporal anchor.
    """
    sentences = _split_sentences(transcript)
    if not sentences:
        cleaned = transcript.strip()
        if not cleaned:
            return []
        sentences = [cleaned]

    chunks: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        current.append(sentence)
        if len(current) >= max_sentences_per_segment:
            chunks.append(" ".join(current).strip())
            current = []
    if current:
        chunks.append(" ".join(current).strip())

    total_segments = len(chunks)
    if total_segments == 0:
        return []

    inferred_duration = float(duration_seconds) if duration_seconds and duration_seconds > 0 else float(total_segments * 30)
    segment_width = inferred_duration / total_segments

    records: list[TranscriptSegmentRecord] = []
    for index, chunk in enumerate(chunks):
        start_sec = round(index * segment_width, 2)
        end_sec = round((index + 1) * segment_width, 2)
        records.append(
            TranscriptSegmentRecord(
                id=str(uuid4()),
                start_sec=start_sec,
                end_sec=end_sec,
                text=chunk,
            )
        )
    return records


def _normalize_confidence(raw: object, default: float = 0.55) -> float:
    try:
        confidence = float(raw)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(confidence, 1.0))


def _map_claim_type(raw: str | None) -> str:
    mapping = {
        "stayed_at": "STAYED_AT",
        "visited": "VISITED",
        "ate_at": "ATE_AT",
        "drank_at": "DRANK_AT",
        "packed": "PACKED",
        "used": "USED",
        "recommends": "RECOMMENDS",
        "purchased": "PURCHASED",
        "itinerary_step": "ITINERARY_STEP",
    }
    return mapping.get((raw or "").lower(), "ITINERARY_STEP")


def _map_entity_type(raw: str | None) -> str:
    mapping = {
        "place": "PLACE",
        "product": "PRODUCT",
        "experience": "EXPERIENCE",
        "brand": "BRAND",
    }
    return mapping.get((raw or "").lower(), "EXPERIENCE")


def _map_opportunity_type(claim: dict) -> str:
    subtype = (claim.get("subtype") or "").lower()
    claim_type = _map_claim_type(claim.get("claim_type"))
    if subtype == "hotel":
        return "HOTEL"
    if subtype == "restaurant":
        return "RESTAURANT"
    if subtype == "cafe":
        return "CAFE"
    if subtype == "attraction":
        return "ATTRACTION"
    if subtype == "activity":
        return "ACTIVITY"
    if subtype in {"travel_product", "gear", "product"}:
        return "TRAVEL_PRODUCT"
    if subtype == "packing_item" or claim_type == "PACKED":
        return "PACKING_ITEM"
    if claim_type == "ITINERARY_STEP":
        return "ITINERARY"
    return "CITY_GUIDE" if _map_entity_type(claim.get("entity_type")) == "PLACE" else "ACTIVITY"


def _find_supporting_segment(
    claim: dict,
    segments: Iterable[TranscriptSegmentRecord],
) -> TranscriptSegmentRecord | None:
    start_sec = claim.get("start_sec")
    end_sec = claim.get("end_sec")
    if isinstance(start_sec, (int, float)) and isinstance(end_sec, (int, float)):
        midpoint = (float(start_sec) + float(end_sec)) / 2
        for segment in segments:
            if segment.start_sec <= midpoint <= segment.end_sec:
                return segment

    raw_label = (claim.get("raw_label") or claim.get("title") or "").strip().lower()
    if raw_label:
        for segment in segments:
            if raw_label in segment.text.lower():
                return segment

    return next(iter(segments), None)


def _delete_existing_graph_rows(db: PgClient, vlog_id: str) -> None:
    db.execute(
        'DELETE FROM "OpportunityEvidence" WHERE "opportunityId" IN (SELECT id FROM "Opportunity" WHERE "vlogId" = %s)',
        (vlog_id,),
    )
    db.execute('DELETE FROM "Opportunity" WHERE "vlogId" = %s', (vlog_id,))
    db.execute(
        'DELETE FROM "ResolvedEntity" WHERE "candidateEntityId" IN (SELECT id FROM "CandidateEntity" WHERE "vlogId" = %s)',
        (vlog_id,),
    )
    db.execute('DELETE FROM "CandidateEntity" WHERE "vlogId" = %s', (vlog_id,))
    db.execute('DELETE FROM "Evidence" WHERE "vlogId" = %s', (vlog_id,))
    db.execute('DELETE FROM "TranscriptSegment" WHERE "vlogId" = %s', (vlog_id,))


def sync_transcript_graph(
    vlog_id: str,
    creator_id: str,
    title: str,
    transcript: str,
    duration_seconds: int | None = None,
) -> dict:
    """
    Persist the phase-1 transcript graph for a vlog.

    Returns summary counts for observability and tests.
    """
    segments = build_transcript_segments(transcript, duration_seconds)
    claims = extract_transcript_opportunities(transcript, title)
    itinerary_blueprint = extract_itinerary_blueprint(transcript, title)

    if not claims:
        logger.info("No transcript opportunities extracted for vlog %s", vlog_id)

    evidence_count = 0
    candidate_count = 0
    opportunity_count = 0

    with PgClient() as db:
        _delete_existing_graph_rows(db, vlog_id)

        for segment in segments:
            db.execute(
                '''INSERT INTO "TranscriptSegment" (
                    id, "vlogId", "startSec", "endSec", text, speaker, source, "createdAt"
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())''',
                (
                    segment.id,
                    vlog_id,
                    segment.start_sec,
                    segment.end_sec,
                    segment.text,
                    None,
                    segment.source,
                ),
            )

        if itinerary_blueprint and not itinerary_blueprint.get("skip") and not itinerary_blueprint.get("not_travel"):
            itinerary_opportunity_id = str(uuid4())
            itinerary_evidence_id = str(uuid4())
            latest_end = segments[-1].end_sec if segments else float(duration_seconds or 30)
            itinerary_confidence = 0.82

            db.execute(
                '''INSERT INTO "Evidence" (
                    id, "vlogId", "sourceType", "claimType", "startSec", "endSec",
                    "transcriptSegmentId", "frameAssetId", confidence, "payloadJson", "createdAt"
                ) VALUES (
                    %s, %s, %s::"EvidenceSourceType", %s::"ClaimType", %s, %s,
                    %s, %s, %s, %s::jsonb, NOW()
                )''',
                (
                    itinerary_evidence_id,
                    vlog_id,
                    "LLM_CLAIM",
                    "ITINERARY_STEP",
                    0.0,
                    latest_end,
                    segments[0].id if segments else None,
                    None,
                    itinerary_confidence,
                    json.dumps(
                        {
                            "title": itinerary_blueprint.get("title") or title,
                            "summary": itinerary_blueprint.get("summary"),
                            "destinations": itinerary_blueprint.get("destinations") or [],
                            "countries": itinerary_blueprint.get("countries") or [],
                            "days": itinerary_blueprint.get("days") or [],
                        }
                    ),
                ),
            )
            evidence_count += 1

            db.execute(
                '''INSERT INTO "Opportunity" (
                    id, "vlogId", "creatorId", "opportunityType", "candidateEntityId",
                    "resolvedEntityId", title, description, "rankScore", confidence,
                    "publishState", "reviewState", "storefrontModule", "metadataJson",
                    "createdAt", "updatedAt"
                ) VALUES (
                    %s, %s, %s, %s::"OpportunityType", %s,
                    %s, %s, %s, %s, %s,
                    %s::"OpportunityPublishState", %s::"OpportunityReviewState", %s, %s::jsonb,
                    NOW(), NOW()
                )''',
                (
                    itinerary_opportunity_id,
                    vlog_id,
                    creator_id,
                    "ITINERARY",
                    None,
                    None,
                    itinerary_blueprint.get("title") or title,
                    itinerary_blueprint.get("summary"),
                    None,
                    itinerary_confidence,
                    "DRAFT",
                    "AUTO_APPROVED",
                    "THIS_ITINERARY",
                    json.dumps(
                        {
                            "itinerary": itinerary_blueprint,
                        }
                    ),
                ),
            )
            opportunity_count += 1

            db.execute(
                'INSERT INTO "OpportunityEvidence" ("opportunityId", "evidenceId") VALUES (%s, %s)',
                (itinerary_opportunity_id, itinerary_evidence_id),
            )

        for claim in claims:
            supporting_segment = _find_supporting_segment(claim, segments)
            start_sec = float(claim.get("start_sec", supporting_segment.start_sec if supporting_segment else 0.0))
            end_sec = float(claim.get("end_sec", supporting_segment.end_sec if supporting_segment else start_sec))
            confidence = _normalize_confidence(claim.get("confidence"))
            evidence_id = str(uuid4())
            candidate_id = str(uuid4())
            opportunity_id = str(uuid4())
            claim_type = _map_claim_type(claim.get("claim_type"))
            entity_type = _map_entity_type(claim.get("entity_type"))
            opportunity_type = _map_opportunity_type(claim)
            raw_label = (claim.get("raw_label") or claim.get("title") or "Unknown").strip()
            payload_json = json.dumps(
                {
                    "title": claim.get("title"),
                    "description": claim.get("description"),
                    "raw_label": raw_label,
                    "evidence_summary": claim.get("evidence_summary"),
                    "attributes": claim.get("attributes") or {},
                }
            )

            db.execute(
                '''INSERT INTO "Evidence" (
                    id, "vlogId", "sourceType", "claimType", "startSec", "endSec",
                    "transcriptSegmentId", "frameAssetId", confidence, "payloadJson", "createdAt"
                ) VALUES (
                    %s, %s, %s::"EvidenceSourceType", %s::"ClaimType", %s, %s,
                    %s, %s, %s, %s::jsonb, NOW()
                )''',
                (
                    evidence_id,
                    vlog_id,
                    "TRANSCRIPT",
                    claim_type,
                    start_sec,
                    end_sec,
                    supporting_segment.id if supporting_segment else None,
                    None,
                    confidence,
                    payload_json,
                ),
            )
            evidence_count += 1

            db.execute(
                '''INSERT INTO "CandidateEntity" (
                    id, "vlogId", "entityType", subtype, "canonicalLabel", "rawLabel",
                    "startSec", "endSec", confidence, status, "evidenceBundleJson",
                    "createdAt", "updatedAt"
                ) VALUES (
                    %s, %s, %s::"CandidateEntityType", %s, %s, %s,
                    %s, %s, %s, %s::"CandidateEntityStatus", %s::jsonb, NOW(), NOW()
                )''',
                (
                    candidate_id,
                    vlog_id,
                    entity_type,
                    claim.get("subtype"),
                    claim.get("title") or raw_label,
                    raw_label,
                    start_sec,
                    end_sec,
                    confidence,
                    "NEW",
                    json.dumps({"evidenceIds": [evidence_id]}),
                ),
            )
            candidate_count += 1

            db.execute(
                '''INSERT INTO "Opportunity" (
                    id, "vlogId", "creatorId", "opportunityType", "candidateEntityId",
                    "resolvedEntityId", title, description, "rankScore", confidence,
                    "publishState", "reviewState", "storefrontModule", "metadataJson",
                    "createdAt", "updatedAt"
                ) VALUES (
                    %s, %s, %s, %s::"OpportunityType", %s,
                    %s, %s, %s, %s, %s,
                    %s::"OpportunityPublishState", %s::"OpportunityReviewState", %s, %s::jsonb,
                    NOW(), NOW()
                )''',
                (
                    opportunity_id,
                    vlog_id,
                    creator_id,
                    opportunity_type,
                    candidate_id,
                    None,
                    claim.get("title") or raw_label,
                    claim.get("description"),
                    None,
                    confidence,
                    "DRAFT",
                    "UNREVIEWED",
                    None,
                    json.dumps(
                        {
                            "claimType": claim_type,
                            "subtype": claim.get("subtype"),
                            "startSec": start_sec,
                            "endSec": end_sec,
                        }
                    ),
                ),
            )
            opportunity_count += 1

            db.execute(
                'INSERT INTO "OpportunityEvidence" ("opportunityId", "evidenceId") VALUES (%s, %s)',
                (opportunity_id, evidence_id),
            )

        db.execute(
            '''UPDATE "Vlog"
               SET "reviewReadyAt" = CASE WHEN %s > 0 THEN NOW() ELSE "reviewReadyAt" END,
                   "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (opportunity_count, vlog_id),
        )

    return {
        "segments": len(segments),
        "evidences": evidence_count,
        "candidate_entities": candidate_count,
        "opportunities": opportunity_count,
    }
