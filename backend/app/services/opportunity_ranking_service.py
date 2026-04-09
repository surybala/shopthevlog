"""
Deterministic opportunity ranking for the evidence-backed graph.
"""
from __future__ import annotations

import json

from app.db.pg_client import PgClient


CREATOR_RELEVANCE = {
    "ITINERARY": 1.0,
    "HOTEL": 0.95,
    "RESTAURANT": 0.9,
    "CAFE": 0.82,
    "ATTRACTION": 0.86,
    "ACTIVITY": 0.84,
    "TRAVEL_PRODUCT": 0.78,
    "PACKING_ITEM": 0.76,
    "CITY_GUIDE": 0.72,
    "PACKING_LIST": 0.7,
}

COMMERCIAL_VALUE = {
    "ITINERARY": 0.65,
    "HOTEL": 1.0,
    "RESTAURANT": 0.72,
    "CAFE": 0.62,
    "ATTRACTION": 0.77,
    "ACTIVITY": 0.85,
    "TRAVEL_PRODUCT": 0.88,
    "PACKING_ITEM": 0.82,
    "CITY_GUIDE": 0.55,
    "PACKING_LIST": 0.68,
}

DEMAND_PROXY = {
    "ITINERARY": 0.82,
    "HOTEL": 0.95,
    "RESTAURANT": 0.8,
    "CAFE": 0.7,
    "ATTRACTION": 0.86,
    "ACTIVITY": 0.84,
    "TRAVEL_PRODUCT": 0.78,
    "PACKING_ITEM": 0.74,
    "CITY_GUIDE": 0.66,
    "PACKING_LIST": 0.63,
}


def _clamp(value: float) -> float:
    return max(0.0, min(value, 1.0))


def _metadata_dict(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _actionability(row: dict) -> float:
    if row["opportunityType"] == "ITINERARY":
        return 0.95

    metadata = _metadata_dict(row.get("metadataJson"))
    if metadata.get("startSec") is not None and metadata.get("endSec") is not None:
        return 0.85
    if row.get("candidateSubtype") in {"hotel", "restaurant", "cafe", "attraction", "activity"}:
        return 0.8
    if row.get("candidateSubtype") in {"travel_product", "packing_item"}:
        return 0.78
    return 0.62


def _review_bonus(review_state: str | None) -> float:
    if review_state == "AUTO_APPROVED":
        return 0.04
    if review_state in {"APPROVED", "EDITED"}:
        return 0.02
    return 0.0


def _normalize_memory_key(value: str | None) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in (value or ""))
    return " ".join(cleaned.split())


def _memory_adjustment(row: dict, creator_memory: dict[str, dict]) -> float:
    lookup_key = _normalize_memory_key(
        row.get("candidateCanonicalLabel")
        or row.get("candidateRawLabel")
        or row.get("resolvedName")
        or row.get("title")
    )
    if not lookup_key:
        return 0.0

    entity_type = row.get("candidateEntityType")
    accepted_types = {"PLACE", "EXPERIENCE"}
    rejected_memory_type = "REJECTED_PLACE" if entity_type in accepted_types else "REJECTED_PRODUCT"
    accepted_memory_type = "ACCEPTED_PLACE" if entity_type in accepted_types else "ACCEPTED_PRODUCT"

    adjustment = 0.0
    if (accepted_memory_type, lookup_key) in creator_memory:
        adjustment += 0.08
    if (rejected_memory_type, lookup_key) in creator_memory:
        adjustment -= 0.12
    if ("NAMING_PREFERENCE", lookup_key) in creator_memory:
        adjustment += 0.03
    if ("RECURRING_ITEM", lookup_key) in creator_memory:
        adjustment += 0.04
    return adjustment


def _memory_signals(row: dict, creator_memory: dict[tuple[str, str], dict]) -> dict[str, bool | str]:
    lookup_key = _normalize_memory_key(
        row.get("candidateCanonicalLabel")
        or row.get("candidateRawLabel")
        or row.get("resolvedName")
        or row.get("title")
    )
    if not lookup_key:
        return {
            "lookupKey": "",
            "accepted": False,
            "rejected": False,
            "naming_preference": False,
            "recurring_item": False,
        }

    entity_type = row.get("candidateEntityType")
    place_like_types = {"PLACE", "EXPERIENCE"}
    rejected_memory_type = "REJECTED_PLACE" if entity_type in place_like_types else "REJECTED_PRODUCT"
    accepted_memory_type = "ACCEPTED_PLACE" if entity_type in place_like_types else "ACCEPTED_PRODUCT"

    return {
        "lookupKey": lookup_key,
        "accepted": (accepted_memory_type, lookup_key) in creator_memory,
        "rejected": (rejected_memory_type, lookup_key) in creator_memory,
        "naming_preference": ("NAMING_PREFERENCE", lookup_key) in creator_memory,
        "recurring_item": ("RECURRING_ITEM", lookup_key) in creator_memory,
    }


def _resolution_bonus(row: dict) -> float:
    match_type = row.get("resolutionMatchType")
    if match_type == "EXACT":
        return 0.05
    if match_type == "LIKELY":
        return 0.03
    if match_type == "SIMILAR":
        return 0.01
    return 0.0


def _review_recommendation(
    row: dict,
    score: float,
    creator_memory: dict[tuple[str, str], dict],
) -> tuple[str, str, str, list[str]]:
    current_review_state = row.get("reviewState") or "UNREVIEWED"
    resolution_match_type = row.get("resolutionMatchType")
    confidence = _clamp(float(row.get("confidence") or 0.0))
    memory_signals = _memory_signals(row, creator_memory)

    active_signals: list[str] = []
    if memory_signals["accepted"]:
        active_signals.append("accepted_memory")
    if memory_signals["rejected"]:
        active_signals.append("rejected_memory")
    if memory_signals["naming_preference"]:
        active_signals.append("naming_preference")
    if memory_signals["recurring_item"]:
        active_signals.append("recurring_item")
    if resolution_match_type == "EXACT":
        active_signals.append("exact_resolution")
    elif resolution_match_type == "LIKELY":
        active_signals.append("resolved_match")

    if current_review_state in {"APPROVED", "EDITED", "REJECTED", "AUTO_APPROVED"}:
        return (
            current_review_state,
            "preserved_review_state",
            "A prior review decision already exists for this opportunity.",
            active_signals,
        )

    if memory_signals["rejected"]:
        return (
            "UNREVIEWED",
            "needs_scrutiny",
            "Creator history shows a similar item was rejected before, so this should be reviewed manually.",
            active_signals,
        )

    has_positive_memory = bool(
        memory_signals["accepted"]
        or memory_signals["naming_preference"]
        or memory_signals["recurring_item"]
    )
    has_resolved_match = resolution_match_type in {"EXACT", "LIKELY"}

    if has_positive_memory and has_resolved_match and score >= 0.86 and confidence >= 0.72:
        return (
            "AUTO_APPROVED",
            "auto_approved_from_memory",
            "High confidence, successful resolution, and prior creator patterns support auto-approval.",
            active_signals,
        )

    if has_positive_memory:
        return (
            "UNREVIEWED",
            "likely_approve",
            "Creator history suggests this opportunity is likely a good fit, but it still needs a quick review.",
            active_signals,
        )

    if has_resolved_match and score >= 0.82:
        return (
            "UNREVIEWED",
            "strong_candidate",
            "This item has strong evidence and a solid resolution match, so it should be quick to review.",
            active_signals,
        )

    return (
        "UNREVIEWED",
        "standard_review",
        "This opportunity should follow the normal creator review flow.",
        active_signals,
    )


def score_opportunity(row: dict, creator_memory: dict[tuple[str, str], dict] | None = None) -> float:
    confidence = _clamp(float(row.get("confidence") or 0.0))
    opportunity_type = row["opportunityType"]
    creator_memory = creator_memory or {}

    score = (
        confidence * 0.35
        + CREATOR_RELEVANCE.get(opportunity_type, 0.65) * 0.25
        + COMMERCIAL_VALUE.get(opportunity_type, 0.55) * 0.20
        + _actionability(row) * 0.10
        + DEMAND_PROXY.get(opportunity_type, 0.55) * 0.10
        + _review_bonus(row.get("reviewState"))
        + _resolution_bonus(row)
        + _memory_adjustment(row, creator_memory)
    )
    return round(_clamp(score), 4)


def build_review_metadata(
    row: dict,
    score: float,
    creator_memory: dict[tuple[str, str], dict] | None = None,
) -> tuple[str, dict]:
    creator_memory = creator_memory or {}
    review_state, recommendation, reason, signals = _review_recommendation(row, score, creator_memory)
    metadata = _metadata_dict(row.get("metadataJson"))
    metadata["reviewRecommendation"] = recommendation
    metadata["reviewRecommendationReason"] = reason
    metadata["reviewSignals"] = signals
    return review_state, metadata


def rank_opportunities(vlog_id: str) -> dict:
    with PgClient() as db:
        db.execute(
            '''SELECT opp.id, opp.title, opp."creatorId", opp."opportunityType", opp.confidence, opp."reviewState",
                      opp."metadataJson",
                      cand.subtype AS "candidateSubtype",
                      cand."entityType" AS "candidateEntityType",
                      cand."canonicalLabel" AS "candidateCanonicalLabel",
                      cand."rawLabel" AS "candidateRawLabel",
                      resolved."resolvedName",
                      resolved."matchType" AS "resolutionMatchType"
               FROM "Opportunity" opp
               LEFT JOIN "CandidateEntity" cand ON cand.id = opp."candidateEntityId"
               LEFT JOIN "ResolvedEntity" resolved ON resolved.id = opp."resolvedEntityId"
               WHERE opp."vlogId" = %s''',
            (vlog_id,),
        )
        rows = db.fetchall()

        if not rows:
            db.execute(
                '''UPDATE "Vlog"
                   SET "lastPipelineRunAt" = NOW()
                   WHERE id = %s''',
                (vlog_id,),
            )
            return {"ranked": 0}

        creator_id = rows[0]["creatorId"]
        db.execute(
            '''SELECT "memoryType", key, "valueJson"
               FROM "CreatorMemory"
               WHERE "creatorId" = %s''',
            (creator_id,),
        )
        memory_rows = db.fetchall()
        creator_memory = {
            (memory_row["memoryType"], memory_row["key"]): memory_row
            for memory_row in memory_rows
        }

        for row in rows:
            score = score_opportunity(row, creator_memory)
            review_state, metadata = build_review_metadata(row, score, creator_memory)
            db.execute(
                '''UPDATE "Opportunity"
                   SET "rankScore" = %s,
                       "reviewState" = %s::"OpportunityReviewState",
                       "metadataJson" = %s::jsonb,
                       "updatedAt" = NOW()
                   WHERE id = %s''',
                (score, review_state, json.dumps(metadata), row["id"]),
            )

        db.execute(
            '''UPDATE "Vlog"
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    return {"ranked": len(rows)}
