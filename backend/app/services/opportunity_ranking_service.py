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


def score_opportunity(row: dict) -> float:
    confidence = _clamp(float(row.get("confidence") or 0.0))
    opportunity_type = row["opportunityType"]

    score = (
        confidence * 0.35
        + CREATOR_RELEVANCE.get(opportunity_type, 0.65) * 0.25
        + COMMERCIAL_VALUE.get(opportunity_type, 0.55) * 0.20
        + _actionability(row) * 0.10
        + DEMAND_PROXY.get(opportunity_type, 0.55) * 0.10
        + _review_bonus(row.get("reviewState"))
    )
    return round(_clamp(score), 4)


def rank_opportunities(vlog_id: str) -> dict:
    with PgClient() as db:
        db.execute(
            '''SELECT opp.id, opp."opportunityType", opp.confidence, opp."reviewState",
                      opp."metadataJson", cand.subtype AS "candidateSubtype"
               FROM "Opportunity" opp
               LEFT JOIN "CandidateEntity" cand ON cand.id = opp."candidateEntityId"
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

        for row in rows:
            db.execute(
                '''UPDATE "Opportunity"
                   SET "rankScore" = %s, "updatedAt" = NOW()
                   WHERE id = %s''',
                (score_opportunity(row), row["id"]),
            )

        db.execute(
            '''UPDATE "Vlog"
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    return {"ranked": len(rows)}
