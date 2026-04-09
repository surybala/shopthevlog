"""
Visual enrichment for stored frame assets.

This service upgrades coarse frame anchors into multimodal graph records:
- OCR evidence
- object detections
- logo detections
- clip/scene summaries

High-confidence visual signals also create candidate entities and draft
opportunities so downstream fusion/ranking can benefit from the visual pass.
"""
from __future__ import annotations

import json
import logging
from uuid import uuid4

from app.db.pg_client import PgClient
from app.services.gemini_service import extract_visual_opportunities

logger = logging.getLogger(__name__)


def _normalize_confidence(raw: object, default: float = 0.45) -> float:
    try:
        confidence = float(raw)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(confidence, 1.0))


def _map_source_type(raw: str | None) -> str:
    mapping = {
        "ocr": "OCR",
        "object_detection": "OBJECT_DETECTION",
        "logo_detection": "LOGO_DETECTION",
        "clip_summary": "CLIP_SUMMARY",
    }
    return mapping.get((raw or "").lower(), "CLIP_SUMMARY")


def _map_claim_type(raw: str | None) -> str:
    mapping = {
        "visited": "VISITED",
        "used": "USED",
        "packed": "PACKED",
        "recommends": "RECOMMENDS",
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


def _map_opportunity_type(signal: dict) -> str:
    subtype = (signal.get("subtype") or "").lower()
    entity_type = _map_entity_type(signal.get("entity_type"))
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
    if subtype in {"travel_product", "product"}:
        return "TRAVEL_PRODUCT"
    if subtype == "packing_item":
        return "PACKING_ITEM"
    if entity_type == "BRAND":
        return "TRAVEL_PRODUCT"
    return "CITY_GUIDE" if entity_type == "PLACE" else "ACTIVITY"


def _delete_existing_visual_enrichment_rows(db: PgClient, vlog_id: str) -> None:
    db.execute(
        '''DELETE FROM "OpportunityEvidence"
           WHERE "opportunityId" IN (
               SELECT id
               FROM "Opportunity"
               WHERE "vlogId" = %s
                 AND "metadataJson" ->> 'sourceType' = 'VISUAL'
           )''',
        (vlog_id,),
    )
    db.execute(
        '''DELETE FROM "Opportunity"
           WHERE "vlogId" = %s
             AND "metadataJson" ->> 'sourceType' = 'VISUAL' ''',
        (vlog_id,),
    )
    db.execute(
        '''DELETE FROM "ResolvedEntity"
           WHERE "candidateEntityId" IN (
               SELECT id
               FROM "CandidateEntity"
               WHERE "vlogId" = %s
                 AND "evidenceBundleJson" ->> 'source' = 'VISUAL_ENRICHMENT_V1'
           )''',
        (vlog_id,),
    )
    db.execute(
        '''DELETE FROM "CandidateEntity"
           WHERE "vlogId" = %s
             AND "evidenceBundleJson" ->> 'source' = 'VISUAL_ENRICHMENT_V1' ''',
        (vlog_id,),
    )
    db.execute(
        '''DELETE FROM "Evidence"
           WHERE "vlogId" = %s
             AND "sourceType" IN (
                 'OCR'::"EvidenceSourceType",
                 'OBJECT_DETECTION'::"EvidenceSourceType",
                 'LOGO_DETECTION'::"EvidenceSourceType",
                 'CLIP_SUMMARY'::"EvidenceSourceType"
             )''',
        (vlog_id,),
    )


def enrich_visual_graph(vlog_id: str, creator_id: str, title: str) -> dict:
    evidence_count = 0
    candidate_count = 0
    opportunity_count = 0

    with PgClient() as db:
        db.execute(
            '''SELECT fa.id, fa."timestampSec", fa."imageUri",
                      ss.summary, ss."startSec", ss."endSec"
               FROM "FrameAsset" fa
               LEFT JOIN "SceneSegment" ss ON ss.id = fa."sceneSegmentId"
               WHERE fa."vlogId" = %s
               ORDER BY fa."timestampSec" ASC''',
            (vlog_id,),
        )
        frames = db.fetchall()

        _delete_existing_visual_enrichment_rows(db, vlog_id)

        for frame in frames:
            signals = extract_visual_opportunities(frame["imageUri"], title, frame.get("summary"))
            start_sec = float(frame.get("startSec") or frame["timestampSec"])
            end_sec = float(frame.get("endSec") or frame["timestampSec"])

            for signal in signals:
                evidence_id = str(uuid4())
                source_type = _map_source_type(signal.get("source_type"))
                confidence = _normalize_confidence(signal.get("confidence"))
                raw_label = (signal.get("raw_label") or signal.get("title") or "Unknown").strip()
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
                        source_type,
                        _map_claim_type(signal.get("claim_type")),
                        start_sec,
                        end_sec,
                        None,
                        frame["id"],
                        confidence,
                        json.dumps(
                            {
                                "title": signal.get("title"),
                                "raw_label": raw_label,
                                "description": signal.get("description"),
                                "evidence_summary": signal.get("evidence_summary"),
                                "attributes": signal.get("attributes") or {},
                                "sourceType": "VISUAL",
                            }
                        ),
                    ),
                )
                evidence_count += 1

                if confidence < 0.6:
                    continue

                candidate_id = str(uuid4())
                opportunity_id = str(uuid4())
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
                        _map_entity_type(signal.get("entity_type")),
                        signal.get("subtype"),
                        signal.get("title") or raw_label,
                        raw_label,
                        start_sec,
                        end_sec,
                        confidence,
                        "NEW",
                        json.dumps(
                            {
                                "evidenceIds": [evidence_id],
                                "source": "VISUAL_ENRICHMENT_V1",
                                "frameAssetId": frame["id"],
                            }
                        ),
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
                        _map_opportunity_type(signal),
                        candidate_id,
                        None,
                        signal.get("title") or raw_label,
                        signal.get("description"),
                        None,
                        confidence,
                        "DRAFT",
                        "UNREVIEWED",
                        None,
                        json.dumps(
                            {
                                "sourceType": "VISUAL",
                                "visualSourceType": source_type,
                                "frameAssetId": frame["id"],
                                "subtype": signal.get("subtype"),
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
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    logger.info(
        "Enriched vlog %s with %s visual evidences, %s candidates, %s opportunities",
        vlog_id,
        evidence_count,
        candidate_count,
        opportunity_count,
    )
    return {
        "evidences": evidence_count,
        "candidate_entities": candidate_count,
        "opportunities": opportunity_count,
    }
