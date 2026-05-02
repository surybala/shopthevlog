"""
Deterministic candidate resolution for the opportunity graph.

This phase does not depend on external providers yet. Instead, it normalizes
candidate entities into resolved graph records so opportunities can point at a
stable resolved entity and future matching logic has a concrete anchor.
"""
from __future__ import annotations

import json

from app.db.pg_client import PgClient


def _normalize_label(label: str | None) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in (label or ""))
    return " ".join(cleaned.split())


def _resolver_type(entity_type: str) -> str:
    if entity_type in {"PLACE", "EXPERIENCE"}:
        return "PLACE_MATCHER"
    return "PRODUCT_MATCHER"


def _match_type(candidate: dict) -> str:
    canonical = _normalize_label(candidate.get("canonicalLabel"))
    raw = _normalize_label(candidate.get("rawLabel"))
    if canonical and raw and canonical == raw:
        return "EXACT"
    if canonical:
        return "LIKELY"
    return "UNRESOLVED"


def resolve_candidates(vlog_id: str) -> dict:
    with PgClient() as db:
        db.execute(
            '''SELECT cand.id, cand."entityType", cand.subtype, cand."canonicalLabel", cand."rawLabel",
                      cand.confidence, cand.status
               FROM "CandidateEntity" cand
               WHERE cand."vlogId" = %s
               ORDER BY cand."createdAt" ASC''',
            (vlog_id,),
        )
        candidates = db.fetchall()

        if not candidates:
            db.execute(
                '''UPDATE "Vlog"
                   SET "lastPipelineRunAt" = NOW()
                   WHERE id = %s''',
                (vlog_id,),
            )
            return {"resolved": 0}

        resolved_count = 0
        for candidate in candidates:
            resolved_name = candidate.get("canonicalLabel") or candidate.get("rawLabel")
            if not resolved_name:
                continue

            normalized_label = _normalize_label(resolved_name)
            resolver_type = _resolver_type(candidate["entityType"])
            match_type = _match_type(candidate)

            db.execute(
                '''INSERT INTO "ResolvedEntity" (
                    id, "candidateEntityId", "resolverType", provider, "externalId",
                    "resolvedName", "matchType", confidence, "metadataJson", "createdAt"
                ) VALUES (
                    gen_random_uuid()::text, %s, %s::"ResolverType", %s, %s,
                    %s, %s::"ResolutionMatchType", %s, %s::jsonb, NOW()
                )
                RETURNING id''',
                (
                    candidate["id"],
                    resolver_type,
                    "INTERNAL_GRAPH_V1",
                    normalized_label or None,
                    resolved_name,
                    match_type,
                    candidate["confidence"],
                    json.dumps(
                        {
                            "normalizedLabel": normalized_label,
                            "entityType": candidate["entityType"],
                            "subtype": candidate.get("subtype"),
                        }
                    ),
                ),
            )
            resolved_entity = db.fetchone()

            db.execute(
                '''UPDATE "CandidateEntity"
                   SET status = 'RESOLVED', "updatedAt" = NOW()
                   WHERE id = %s''',
                (candidate["id"],),
            )
            db.execute(
                '''UPDATE "Opportunity"
                   SET "resolvedEntityId" = %s, "updatedAt" = NOW()
                   WHERE "candidateEntityId" = %s''',
                (resolved_entity["id"], candidate["id"]),
            )
            resolved_count += 1

        db.execute(
            '''UPDATE "Vlog"
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    return {"resolved": resolved_count}
