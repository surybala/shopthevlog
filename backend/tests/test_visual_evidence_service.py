"""
Tests for app.services.visual_evidence_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


def test_build_scene_segments_creates_deterministic_uniform_ranges():
    from app.services.visual_evidence_service import build_scene_segments

    scenes = build_scene_segments(180, target_scene_seconds=60)

    assert len(scenes) == 3
    assert scenes[0].start_sec == 0.0
    assert scenes[0].end_sec == 60.0
    assert scenes[1].start_sec == 60.0
    assert scenes[2].end_sec == 180.0
    assert scenes[0].sampling_strategy == "uniform-midpoint-v1"


def test_build_scene_segments_falls_back_when_duration_is_missing():
    from app.services.visual_evidence_service import build_scene_segments

    scenes = build_scene_segments(None)

    assert len(scenes) == 1
    assert scenes[0].start_sec == 0.0
    assert scenes[0].end_sec == 30.0


def test_sync_visual_evidence_persists_scenes_frames_and_evidence():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg):
        from app.services.visual_evidence_service import sync_visual_evidence

        result = sync_visual_evidence(
            "vlog-001",
            "Tokyo vlog",
            duration_seconds=120,
            thumbnail_url="https://cdn.example.com/thumb.jpg",
        )

    assert result == {
        "scene_segments": 2,
        "frame_assets": 2,
        "evidences": 2,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('INSERT INTO "SceneSegment"' in sql for sql in sql_statements)
    assert any('INSERT INTO "FrameAsset"' in sql for sql in sql_statements)
    assert any('INSERT INTO "Evidence"' in sql for sql in sql_statements)
    assert any('UPDATE "Vlog"' in sql for sql in sql_statements)

    frame_inserts = [params for sql, params in fake_pg.cursor.queries if 'INSERT INTO "FrameAsset"' in sql]
    assert frame_inserts[0][4] == "https://cdn.example.com/thumb.jpg#t=30"
    assert frame_inserts[1][4] == "https://cdn.example.com/thumb.jpg#t=90"


def test_sync_visual_evidence_clears_previous_visual_rows_before_reinserting():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg):
        from app.services.visual_evidence_service import sync_visual_evidence

        sync_visual_evidence("vlog-001", "Tokyo vlog", duration_seconds=45)

    sql_statements = [query for query, _params in fake_pg.cursor.queries[:4]]
    assert 'DELETE FROM "OpportunityEvidence"' in sql_statements[0]
    assert 'DELETE FROM "Evidence"' in sql_statements[1]
    assert 'DELETE FROM "FrameAsset"' in sql_statements[2]
    assert 'DELETE FROM "SceneSegment"' in sql_statements[3]
