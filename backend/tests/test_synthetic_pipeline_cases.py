from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

import pytest


def _load_cases():
    fixture_path = Path(__file__).parent / "fixtures" / "synthetic_pipeline_cases.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


class StatefulPipelinePgClient:
    def __init__(self, vlog_id: str, creator_id: str, creator_memory: dict[str, dict]):
        self.tables = {
            "Vlog": [
                {
                    "id": vlog_id,
                    "creatorId": creator_id,
                    "lastPipelineRunAt": None,
                    "reviewReadyAt": None,
                    "pipelineStatus": "PENDING",
                    "pipelineError": None,
                }
            ],
            "TranscriptSegment": [],
            "SceneSegment": [],
            "FrameAsset": [],
            "Evidence": [],
            "CandidateEntity": [],
            "ResolvedEntity": [],
            "Opportunity": [],
            "OpportunityEvidence": [],
            "CreatorMemory": [
                {
                    "memoryType": raw_key.split("|", 1)[0],
                    "key": raw_key.split("|", 1)[1],
                    "valueJson": value,
                    "creatorId": creator_id,
                }
                for raw_key, value in creator_memory.items()
            ],
        }
        self.cursor = SimpleNamespace(queries=[])
        self.conn = SimpleNamespace(commit=lambda: None, rollback=lambda: None, close=lambda: None)
        self._selected_rows: list[dict] = []
        self._selected_row: dict | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()

    def fetchall(self) -> list[dict]:
        return deepcopy(self._selected_rows)

    def fetchone(self) -> dict | None:
        return deepcopy(self._selected_row)

    def _find_by_id(self, table_name: str, row_id: str) -> dict:
        for row in self.tables[table_name]:
            if row["id"] == row_id:
                return row
        raise KeyError(f"{table_name} row not found: {row_id}")

    def execute(self, sql: str, params=None):
        self.cursor.queries.append((sql, params))
        statement = " ".join(sql.split())

        if statement.startswith('DELETE FROM "OpportunityEvidence" WHERE "opportunityId" IN (SELECT id FROM "Opportunity" WHERE "vlogId" = %s)'):
            vlog_id = params[0]
            opportunity_ids = {row["id"] for row in self.tables["Opportunity"] if row["vlogId"] == vlog_id}
            self.tables["OpportunityEvidence"] = [
                row for row in self.tables["OpportunityEvidence"] if row["opportunityId"] not in opportunity_ids
            ]
            return
        if statement.startswith('DELETE FROM "OpportunityEvidence" WHERE "evidenceId" IN ( SELECT id FROM "Evidence" WHERE "vlogId" = %s'):
            vlog_id = params[0]
            evidence_ids = {
                row["id"]
                for row in self.tables["Evidence"]
                if row["vlogId"] == vlog_id and row["sourceType"] in {"OCR", "SCENE_SUMMARY", "OBJECT_DETECTION", "LOGO_DETECTION", "CLIP_SUMMARY"}
            }
            self.tables["OpportunityEvidence"] = [
                row for row in self.tables["OpportunityEvidence"] if row["evidenceId"] not in evidence_ids
            ]
            return
        if statement == 'DELETE FROM "Opportunity" WHERE "vlogId" = %s':
            vlog_id = params[0]
            self.tables["Opportunity"] = [row for row in self.tables["Opportunity"] if row["vlogId"] != vlog_id]
            return
        if statement.startswith('DELETE FROM "ResolvedEntity" WHERE "candidateEntityId" IN (SELECT id FROM "CandidateEntity" WHERE "vlogId" = %s)'):
            vlog_id = params[0]
            candidate_ids = {row["id"] for row in self.tables["CandidateEntity"] if row["vlogId"] == vlog_id}
            self.tables["ResolvedEntity"] = [
                row for row in self.tables["ResolvedEntity"] if row["candidateEntityId"] not in candidate_ids
            ]
            return
        if statement == 'DELETE FROM "CandidateEntity" WHERE "vlogId" = %s':
            vlog_id = params[0]
            self.tables["CandidateEntity"] = [row for row in self.tables["CandidateEntity"] if row["vlogId"] != vlog_id]
            return
        if statement == 'DELETE FROM "Evidence" WHERE "vlogId" = %s':
            vlog_id = params[0]
            self.tables["Evidence"] = [row for row in self.tables["Evidence"] if row["vlogId"] != vlog_id]
            return
        if statement.startswith('DELETE FROM "TranscriptSegment" WHERE "vlogId" = %s'):
            vlog_id = params[0]
            self.tables["TranscriptSegment"] = [row for row in self.tables["TranscriptSegment"] if row["vlogId"] != vlog_id]
            return
        if statement.startswith('DELETE FROM "FrameAsset" WHERE "vlogId" = %s'):
            vlog_id = params[0]
            self.tables["FrameAsset"] = [row for row in self.tables["FrameAsset"] if row["vlogId"] != vlog_id]
            return
        if statement.startswith('DELETE FROM "SceneSegment" WHERE "vlogId" = %s'):
            vlog_id = params[0]
            self.tables["SceneSegment"] = [row for row in self.tables["SceneSegment"] if row["vlogId"] != vlog_id]
            return
        if 'DELETE FROM "OpportunityEvidence"' in statement and '"metadataJson" ->> \'sourceType\' = \'VISUAL\'' in statement:
            visual_opp_ids = {
                row["id"]
                for row in self.tables["Opportunity"]
                if row["metadataJson"].get("sourceType") == "VISUAL"
            }
            self.tables["OpportunityEvidence"] = [
                row for row in self.tables["OpportunityEvidence"] if row["opportunityId"] not in visual_opp_ids
            ]
            return
        if 'DELETE FROM "Opportunity"' in statement and '"metadataJson" ->> \'sourceType\' = \'VISUAL\'' in statement:
            self.tables["Opportunity"] = [
                row for row in self.tables["Opportunity"] if row["metadataJson"].get("sourceType") != "VISUAL"
            ]
            return
        if 'DELETE FROM "ResolvedEntity"' in statement and '"evidenceBundleJson" ->> \'source\' = \'VISUAL_ENRICHMENT_V1\'' in statement:
            visual_candidate_ids = {
                row["id"]
                for row in self.tables["CandidateEntity"]
                if row["evidenceBundleJson"].get("source") == "VISUAL_ENRICHMENT_V1"
            }
            self.tables["ResolvedEntity"] = [
                row for row in self.tables["ResolvedEntity"] if row["candidateEntityId"] not in visual_candidate_ids
            ]
            return
        if 'DELETE FROM "CandidateEntity"' in statement and '"evidenceBundleJson" ->> \'source\' = \'VISUAL_ENRICHMENT_V1\'' in statement:
            self.tables["CandidateEntity"] = [
                row for row in self.tables["CandidateEntity"] if row["evidenceBundleJson"].get("source") != "VISUAL_ENRICHMENT_V1"
            ]
            return
        if 'DELETE FROM "Evidence"' in statement and '"sourceType" IN (' in statement:
            removable_types = {"OCR", "SCENE_SUMMARY", "OBJECT_DETECTION", "LOGO_DETECTION", "CLIP_SUMMARY"}
            self.tables["Evidence"] = [
                row for row in self.tables["Evidence"] if row["sourceType"] not in removable_types
            ]
            return

        if 'INSERT INTO "TranscriptSegment"' in statement:
            self.tables["TranscriptSegment"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "startSec": params[2],
                    "endSec": params[3],
                    "text": params[4],
                    "speaker": params[5],
                    "source": params[6],
                }
            )
            return
        if 'INSERT INTO "SceneSegment"' in statement:
            self.tables["SceneSegment"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "startSec": params[2],
                    "endSec": params[3],
                    "sceneType": params[4],
                    "summary": params[5],
                    "samplingStrategy": params[6],
                }
            )
            return
        if 'INSERT INTO "FrameAsset"' in statement:
            self.tables["FrameAsset"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "sceneSegmentId": params[2],
                    "timestampSec": params[3],
                    "imageUri": params[4],
                    "width": params[5],
                    "height": params[6],
                }
            )
            return
        if 'INSERT INTO "Evidence"' in statement:
            payload = params[9]
            self.tables["Evidence"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "sourceType": params[2],
                    "claimType": params[3],
                    "startSec": params[4],
                    "endSec": params[5],
                    "transcriptSegmentId": params[6],
                    "frameAssetId": params[7],
                    "confidence": params[8],
                    "payloadJson": json.loads(payload) if isinstance(payload, str) else payload,
                }
            )
            return
        if 'INSERT INTO "CandidateEntity"' in statement:
            payload = params[10]
            self.tables["CandidateEntity"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "entityType": params[2],
                    "subtype": params[3],
                    "canonicalLabel": params[4],
                    "rawLabel": params[5],
                    "startSec": params[6],
                    "endSec": params[7],
                    "confidence": params[8],
                    "status": params[9],
                    "evidenceBundleJson": json.loads(payload) if isinstance(payload, str) else payload,
                }
            )
            return
        if 'INSERT INTO "Opportunity" (' in statement:
            payload = params[13]
            self.tables["Opportunity"].append(
                {
                    "id": params[0],
                    "vlogId": params[1],
                    "creatorId": params[2],
                    "opportunityType": params[3],
                    "candidateEntityId": params[4],
                    "resolvedEntityId": params[5],
                    "title": params[6],
                    "description": params[7],
                    "rankScore": params[8],
                    "confidence": params[9],
                    "publishState": params[10],
                    "reviewState": params[11],
                    "storefrontModule": params[12],
                    "metadataJson": json.loads(payload) if isinstance(payload, str) else payload,
                }
            )
            return
        if 'INSERT INTO "OpportunityEvidence"' in statement:
            self.tables["OpportunityEvidence"].append(
                {
                    "opportunityId": params[0],
                    "evidenceId": params[1],
                }
            )
            return
        if 'INSERT INTO "ResolvedEntity"' in statement:
            resolved_id = str(uuid4())
            metadata = params[7]
            self.tables["ResolvedEntity"].append(
                {
                    "id": resolved_id,
                    "candidateEntityId": params[0],
                    "resolverType": params[1],
                    "provider": params[2],
                    "externalId": params[3],
                    "resolvedName": params[4],
                    "matchType": params[5],
                    "confidence": params[6],
                    "metadataJson": json.loads(metadata) if isinstance(metadata, str) else metadata,
                }
            )
            self._selected_row = {"id": resolved_id}
            return

        if statement.startswith('SELECT fa.id, fa."timestampSec", fa."imageUri", ss.summary, ss."startSec", ss."endSec" FROM "FrameAsset" fa'):
            vlog_id = params[0]
            scene_by_id = {row["id"]: row for row in self.tables["SceneSegment"]}
            self._selected_rows = [
                {
                    "id": frame["id"],
                    "timestampSec": frame["timestampSec"],
                    "imageUri": frame["imageUri"],
                    "summary": scene_by_id.get(frame["sceneSegmentId"], {}).get("summary"),
                    "startSec": scene_by_id.get(frame["sceneSegmentId"], {}).get("startSec"),
                    "endSec": scene_by_id.get(frame["sceneSegmentId"], {}).get("endSec"),
                }
                for frame in sorted(self.tables["FrameAsset"], key=lambda row: row["timestampSec"])
                if frame["vlogId"] == vlog_id
            ]
            return
        if statement.startswith('SELECT id, "entityType", subtype, "canonicalLabel", "rawLabel", "startSec", "endSec", confidence, status, "evidenceBundleJson" FROM "CandidateEntity"'):
            vlog_id = params[0]
            self._selected_rows = [
                deepcopy(row) for row in self.tables["CandidateEntity"] if row["vlogId"] == vlog_id
            ]
            return
        if statement.startswith('SELECT cand.id, cand."entityType", cand.subtype, cand."canonicalLabel", cand."rawLabel", cand.confidence, cand.status FROM "CandidateEntity" cand'):
            vlog_id = params[0]
            self._selected_rows = [
                {
                    "id": row["id"],
                    "entityType": row["entityType"],
                    "subtype": row["subtype"],
                    "canonicalLabel": row["canonicalLabel"],
                    "rawLabel": row["rawLabel"],
                    "confidence": row["confidence"],
                    "status": row["status"],
                }
                for row in self.tables["CandidateEntity"]
                if row["vlogId"] == vlog_id
            ]
            return
        if statement.startswith('SELECT opp.id, opp.title, opp."creatorId", opp."opportunityType", opp.confidence, opp."reviewState", opp."metadataJson",'):
            vlog_id = params[0]
            candidates = {row["id"]: row for row in self.tables["CandidateEntity"]}
            resolved_entities = {row["id"]: row for row in self.tables["ResolvedEntity"]}
            self._selected_rows = []
            for opp in self.tables["Opportunity"]:
                if opp["vlogId"] != vlog_id:
                    continue
                candidate = candidates.get(opp["candidateEntityId"])
                resolved = resolved_entities.get(opp["resolvedEntityId"])
                self._selected_rows.append(
                    {
                        "id": opp["id"],
                        "title": opp["title"],
                        "creatorId": opp["creatorId"],
                        "opportunityType": opp["opportunityType"],
                        "confidence": opp["confidence"],
                        "reviewState": opp["reviewState"],
                        "metadataJson": deepcopy(opp["metadataJson"]),
                        "candidateSubtype": candidate.get("subtype") if candidate else None,
                        "candidateEntityType": candidate.get("entityType") if candidate else None,
                        "candidateCanonicalLabel": candidate.get("canonicalLabel") if candidate else None,
                        "candidateRawLabel": candidate.get("rawLabel") if candidate else None,
                        "candidateEvidenceBundleJson": deepcopy(candidate.get("evidenceBundleJson")) if candidate else {},
                        "resolvedName": resolved.get("resolvedName") if resolved else None,
                        "resolutionMatchType": resolved.get("matchType") if resolved else None,
                    }
                )
            return
        if statement.startswith('SELECT "memoryType", key, "valueJson" FROM "CreatorMemory" WHERE "creatorId" = %s'):
            creator_id = params[0]
            self._selected_rows = [
                {
                    "memoryType": row["memoryType"],
                    "key": row["key"],
                    "valueJson": row["valueJson"],
                }
                for row in self.tables["CreatorMemory"]
                if row["creatorId"] == creator_id
            ]
            return

        if statement.startswith('UPDATE "CandidateEntity" SET "canonicalLabel" = %s,'):
            row = self._find_by_id("CandidateEntity", params[5])
            row["canonicalLabel"] = params[0]
            row["startSec"] = params[1]
            row["endSec"] = params[2]
            row["confidence"] = params[3]
            row["evidenceBundleJson"] = json.loads(params[4]) if isinstance(params[4], str) else params[4]
            return
        if statement.startswith('UPDATE "Opportunity" SET "candidateEntityId" = %s, "updatedAt" = NOW() WHERE "candidateEntityId" = %s'):
            for row in self.tables["Opportunity"]:
                if row["candidateEntityId"] == params[1]:
                    row["candidateEntityId"] = params[0]
            return
        if statement.startswith('DELETE FROM "ResolvedEntity" WHERE "candidateEntityId" = %s'):
            self.tables["ResolvedEntity"] = [
                row for row in self.tables["ResolvedEntity"] if row["candidateEntityId"] != params[0]
            ]
            return
        if statement.startswith('DELETE FROM "CandidateEntity" WHERE id = %s'):
            self.tables["CandidateEntity"] = [row for row in self.tables["CandidateEntity"] if row["id"] != params[0]]
            return
        if statement.startswith('UPDATE "CandidateEntity" SET status = \'RESOLVED\', "updatedAt" = NOW() WHERE id = %s'):
            self._find_by_id("CandidateEntity", params[0])["status"] = "RESOLVED"
            return
        if statement.startswith('UPDATE "Opportunity" SET "resolvedEntityId" = %s, "updatedAt" = NOW() WHERE "candidateEntityId" = %s'):
            for row in self.tables["Opportunity"]:
                if row["candidateEntityId"] == params[1]:
                    row["resolvedEntityId"] = params[0]
            return
        if statement.startswith('UPDATE "Opportunity" SET "rankScore" = %s, "reviewState" = %s::"OpportunityReviewState", "metadataJson" = %s::jsonb, "updatedAt" = NOW() WHERE id = %s'):
            row = self._find_by_id("Opportunity", params[3])
            row["rankScore"] = params[0]
            row["reviewState"] = params[1]
            row["metadataJson"] = json.loads(params[2]) if isinstance(params[2], str) else params[2]
            return
        if statement.startswith('UPDATE "Vlog" SET "reviewReadyAt" = CASE WHEN %s > 0 THEN NOW() ELSE "reviewReadyAt" END, "lastPipelineRunAt" = NOW() WHERE id = %s'):
            row = self._find_by_id("Vlog", params[1])
            if params[0] > 0:
                row["reviewReadyAt"] = "NOW"
            row["lastPipelineRunAt"] = "NOW"
            return
        if statement.startswith('UPDATE "Vlog" SET "lastPipelineRunAt" = NOW() WHERE id = %s'):
            self._find_by_id("Vlog", params[0])["lastPipelineRunAt"] = "NOW"
            return

        raise AssertionError(f"Unhandled SQL in synthetic pipeline harness: {statement}")


def _store_frame_asset_stub(*, creator_id: str, vlog_id: str, timestamp_sec: float, **_kwargs):
    return SimpleNamespace(
        path=f"creators/{creator_id}/vlogs/{vlog_id}/frames/frame-{int(timestamp_sec):06d}.jpg",
        public_url=f"https://storage.example.com/{creator_id}/{vlog_id}/frame-{int(timestamp_sec):06d}.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
    )


def _extract_visual_batch_stub(visual_signals_by_frame_index):
    def _inner(frames, _title):
        result = {}
        for index, frame in enumerate(frames):
            result[frame["frame_id"]] = deepcopy(visual_signals_by_frame_index[index]) if index < len(visual_signals_by_frame_index) else []
        return result

    return _inner


@pytest.mark.parametrize("case", _load_cases(), ids=lambda case: case["name"])
def test_synthetic_pipeline_cases(case):
    from app.services.fusion_service import fuse_candidate_entities
    from app.services.opportunity_ranking_service import rank_opportunities
    from app.services.resolution_service import resolve_candidates
    from app.services.transcript_graph_service import sync_transcript_graph
    from app.services.visual_enrichment_service import enrich_visual_graph
    from app.services.visual_evidence_service import sync_visual_evidence

    fake_pg = StatefulPipelinePgClient(case["vlogId"], case["creatorId"], case.get("creatorMemory", {}))

    visual_midpoints = [30.0 + 60.0 * index for index in range(case["expected"]["sceneSegments"])]
    extracted_frames = {timestamp: (f"frame-{timestamp}".encode("utf-8"), "image/jpeg") for timestamp in visual_midpoints}

    with (
        patch("app.services.transcript_graph_service.PgClient", return_value=fake_pg),
        patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg),
        patch("app.services.visual_enrichment_service.PgClient", return_value=fake_pg),
        patch("app.services.fusion_service.PgClient", return_value=fake_pg),
        patch("app.services.resolution_service.PgClient", return_value=fake_pg),
        patch("app.services.opportunity_ranking_service.PgClient", return_value=fake_pg),
        patch(
            "app.services.transcript_graph_service.extract_transcript_graph_payload",
            return_value=deepcopy(case["transcriptGraphPayload"]),
        ),
        patch("app.services.visual_evidence_service.load_cached_frame_assets", return_value={}),
        patch("app.services.visual_evidence_service.extract_video_frames", return_value=extracted_frames),
        patch("app.services.visual_evidence_service.store_frame_asset", side_effect=_store_frame_asset_stub),
        patch("app.services.visual_evidence_service.write_frame_manifest"),
        patch(
            "app.services.visual_enrichment_service.extract_visual_opportunities_batch",
            side_effect=_extract_visual_batch_stub(case["visualSignalsByFrameIndex"]),
        ),
    ):
        transcript_result = sync_transcript_graph(
            case["vlogId"],
            case["creatorId"],
            case["title"],
            case["transcript"],
            case["durationSeconds"],
        )
        visual_result = sync_visual_evidence(
            case["vlogId"],
            case["creatorId"],
            case["title"],
            duration_seconds=case["durationSeconds"],
            external_video_url="https://example.com/video.mp4",
            thumbnail_url="https://example.com/thumb.jpg",
        )
        enrichment_result = enrich_visual_graph(case["vlogId"], case["creatorId"], case["title"])
        fusion_result = fuse_candidate_entities(case["vlogId"])
        resolution_result = resolve_candidates(case["vlogId"])
        ranking_result = rank_opportunities(case["vlogId"])

    assert transcript_result["segments"] >= 1
    assert visual_result["scene_segments"] == case["expected"]["sceneSegments"]
    assert visual_result["frame_assets"] == case["expected"]["frameAssets"]
    assert enrichment_result["evidences"] >= 1
    assert fusion_result["remaining_candidates"] >= 1
    assert resolution_result["resolved"] >= 1
    assert ranking_result["ranked"] >= case["expected"]["minimumOpportunityCount"]

    ranked_rows = fake_pg.tables["Opportunity"]
    assert len(ranked_rows) >= case["expected"]["minimumOpportunityCount"]

    for title_check in case["expected"]["titleChecks"]:
        matching_rows = [row for row in ranked_rows if row["title"] == title_check["title"]]
        assert matching_rows, f'Missing opportunity titled {title_check["title"]}'

        minimum_matches = title_check.get("minimumMatches", 1)
        assert len(matching_rows) >= minimum_matches

        if "minimumScore" in title_check:
            assert max(float(row["rankScore"] or 0.0) for row in matching_rows) >= title_check["minimumScore"]
        if "maximumScore" in title_check:
            assert max(float(row["rankScore"] or 0.0) for row in matching_rows) <= title_check["maximumScore"]
        if "reviewState" in title_check:
            assert any(row["reviewState"] == title_check["reviewState"] for row in matching_rows)
        if "reviewRecommendation" in title_check:
            assert any(
                row["metadataJson"].get("reviewRecommendation") == title_check["reviewRecommendation"]
                for row in matching_rows
            )
        for required_signal in title_check.get("requiredSignals", []):
            assert any(
                required_signal in row["metadataJson"].get("reviewSignals", [])
                for row in matching_rows
            ), f'Missing signal {required_signal} for title {title_check["title"]}'
