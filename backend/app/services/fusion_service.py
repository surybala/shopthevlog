"""
Deterministic candidate fusion for the opportunity graph.

Phase 4 starts consolidating graph records so transcript and visual evidence can
eventually converge on shared opportunity entities. The current implementation
focuses on deduplicating overlapping candidate entities with the same normalized
identity and rolling their evidence together.
"""
from __future__ import annotations

import json
from collections import defaultdict

from app.db.pg_client import PgClient


def _normalize_label(label: str | None) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in (label or ""))
    return " ".join(cleaned.split())


def _coerce_evidence_bundle(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _confidence_boost(confidences: list[float]) -> float:
    if not confidences:
        return 0.0
    boosted = max(confidences) + (0.04 * max(0, len(confidences) - 1))
    return max(0.0, min(boosted, 1.0))


def fuse_candidate_entities(vlog_id: str) -> dict:
    with PgClient() as db:
        db.execute(
            '''SELECT id, "entityType", subtype, "canonicalLabel", "rawLabel",
                      "startSec", "endSec", confidence, status, "evidenceBundleJson"
               FROM "CandidateEntity"
               WHERE "vlogId" = %s
               ORDER BY "startSec" ASC, "createdAt" ASC''',
            (vlog_id,),
        )
        rows = db.fetchall()

        grouped: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
        for row in rows:
            key = (
                row["entityType"],
                row.get("subtype") or "",
                _normalize_label(row.get("canonicalLabel") or row.get("rawLabel")),
            )
            grouped[key].append(row)

        merged_candidates = 0
        fused_clusters = 0

        for (entity_type, subtype, normalized_label), candidates in grouped.items():
            if len(candidates) <= 1 or not normalized_label:
                continue

            primary = candidates[0]
            all_evidence_ids: list[str] = []
            confidences: list[float] = []
            start_sec = primary["startSec"]
            end_sec = primary["endSec"]

            for candidate in candidates:
                bundle = _coerce_evidence_bundle(candidate.get("evidenceBundleJson"))
                all_evidence_ids.extend(
                    evidence_id
                    for evidence_id in bundle.get("evidenceIds", [])
                    if isinstance(evidence_id, str)
                )
                if candidate.get("confidence") is not None:
                    confidences.append(float(candidate["confidence"]))
                start_sec = min(start_sec, candidate["startSec"])
                end_sec = max(end_sec, candidate["endSec"])

            unique_evidence_ids = list(dict.fromkeys(all_evidence_ids))
            db.execute(
                '''UPDATE "CandidateEntity"
                   SET "canonicalLabel" = %s,
                       "startSec" = %s,
                       "endSec" = %s,
                       confidence = %s,
                       "evidenceBundleJson" = %s::jsonb,
                       "updatedAt" = NOW()
                   WHERE id = %s''',
                (
                    primary.get("canonicalLabel") or primary.get("rawLabel"),
                    start_sec,
                    end_sec,
                    _confidence_boost(confidences),
                    json.dumps(
                        {
                            "evidenceIds": unique_evidence_ids,
                            "fusedCandidateIds": [candidate["id"] for candidate in candidates],
                            "fusionVersion": "phase4-v1",
                            "entityType": entity_type,
                            "subtype": subtype or None,
                            "normalizedLabel": normalized_label,
                        }
                    ),
                    primary["id"],
                ),
            )

            for duplicate in candidates[1:]:
                db.execute(
                    '''UPDATE "Opportunity"
                       SET "candidateEntityId" = %s, "updatedAt" = NOW()
                       WHERE "candidateEntityId" = %s''',
                    (primary["id"], duplicate["id"]),
                )
                db.execute('DELETE FROM "ResolvedEntity" WHERE "candidateEntityId" = %s', (duplicate["id"],))
                db.execute('DELETE FROM "CandidateEntity" WHERE id = %s', (duplicate["id"],))
                merged_candidates += 1

            fused_clusters += 1

        db.execute(
            '''UPDATE "Vlog"
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    return {
        "clusters": fused_clusters,
        "merged_candidates": merged_candidates,
        "remaining_candidates": len(rows) - merged_candidates,
    }
