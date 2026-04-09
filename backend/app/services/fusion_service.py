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


def _label_tokens(label: str | None) -> set[str]:
    normalized = _normalize_label(label)
    return {token for token in normalized.split() if token}


def _labels_match(left: str | None, right: str | None) -> bool:
    left_tokens = _label_tokens(left)
    right_tokens = _label_tokens(right)
    if not left_tokens or not right_tokens:
        return False
    if left_tokens == right_tokens:
        return True
    if left_tokens.issubset(right_tokens) or right_tokens.issubset(left_tokens):
        return True
    overlap = len(left_tokens & right_tokens)
    return overlap / max(len(left_tokens), len(right_tokens)) >= 0.6


def _source_types(bundle: dict) -> list[str]:
    raw_source_types = bundle.get("sourceTypes")
    if isinstance(raw_source_types, list):
        return [str(source_type) for source_type in raw_source_types if source_type]

    source = bundle.get("source")
    if source == "VISUAL_ENRICHMENT_V1":
        return ["VISUAL"]
    return ["TRANSCRIPT"]


def _confidence_boost(confidences: list[float], source_types: set[str]) -> float:
    if not confidences:
        return 0.0
    boosted = max(confidences) + (0.04 * max(0, len(confidences) - 1))
    if len(source_types) > 1:
        boosted += 0.06
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

        grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for row in rows:
            key = (
                row["entityType"],
                row.get("subtype") or "",
            )
            grouped[key].append(row)

        merged_candidates = 0
        fused_clusters = 0

        for (entity_type, subtype), candidates in grouped.items():
            if len(candidates) <= 1:
                continue

            consumed_ids: set[str] = set()
            for candidate in candidates:
                if candidate["id"] in consumed_ids:
                    continue

                cluster = [candidate]
                candidate_label = candidate.get("canonicalLabel") or candidate.get("rawLabel")
                for other in candidates:
                    if other["id"] == candidate["id"] or other["id"] in consumed_ids:
                        continue
                    other_label = other.get("canonicalLabel") or other.get("rawLabel")
                    if _labels_match(candidate_label, other_label):
                        cluster.append(other)

                if len(cluster) <= 1:
                    consumed_ids.add(candidate["id"])
                    continue

                primary = cluster[0]
                all_evidence_ids: list[str] = []
                confidences: list[float] = []
                source_types: set[str] = set()
                start_sec = primary["startSec"]
                end_sec = primary["endSec"]
                preferred_label = max(
                    (item.get("canonicalLabel") or item.get("rawLabel") or "" for item in cluster),
                    key=lambda label: len(_label_tokens(label)),
                )

                for clustered_candidate in cluster:
                    consumed_ids.add(clustered_candidate["id"])
                    bundle = _coerce_evidence_bundle(clustered_candidate.get("evidenceBundleJson"))
                    all_evidence_ids.extend(
                        evidence_id
                        for evidence_id in bundle.get("evidenceIds", [])
                        if isinstance(evidence_id, str)
                    )
                    source_types.update(_source_types(bundle))
                    if clustered_candidate.get("confidence") is not None:
                        confidences.append(float(clustered_candidate["confidence"]))
                    start_sec = min(start_sec, clustered_candidate["startSec"])
                    end_sec = max(end_sec, clustered_candidate["endSec"])

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
                        preferred_label or primary.get("canonicalLabel") or primary.get("rawLabel"),
                        start_sec,
                        end_sec,
                        _confidence_boost(confidences, source_types),
                        json.dumps(
                            {
                                "evidenceIds": unique_evidence_ids,
                                "fusedCandidateIds": [clustered_candidate["id"] for clustered_candidate in cluster],
                                "fusionVersion": "phase4-v2",
                                "entityType": entity_type,
                                "subtype": subtype or None,
                                "normalizedLabel": _normalize_label(preferred_label),
                                "sourceTypes": sorted(source_types),
                                "isMultimodal": len(source_types) > 1,
                            }
                        ),
                        primary["id"],
                    ),
                )

                for duplicate in cluster[1:]:
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
