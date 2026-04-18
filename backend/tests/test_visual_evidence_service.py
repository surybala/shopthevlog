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

    with (
        patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg),
        patch("app.services.visual_evidence_service.load_cached_frame_assets", return_value={}) as mock_load_cached,
        patch(
            "app.services.visual_evidence_service.extract_video_frames",
            return_value={
                30.0: (b"frame-30", "image/jpeg"),
                90.0: (b"frame-90", "image/jpeg"),
            },
        ) as mock_extract_frame,
        patch("app.services.visual_evidence_service.write_frame_manifest") as mock_write_manifest,
        patch(
            "app.services.visual_evidence_service.store_frame_asset",
            side_effect=[
                type("StoredFrame", (), {"path": "creators/creator-001/vlogs/vlog-001/frames/frame-000030.jpg"})(),
                type("StoredFrame", (), {"path": "creators/creator-001/vlogs/vlog-001/frames/frame-000090.jpg"})(),
            ],
        ) as mock_store_frame,
    ):
        from app.services.visual_evidence_service import sync_visual_evidence

        result = sync_visual_evidence(
            "vlog-001",
            "creator-001",
            "Tokyo vlog",
            duration_seconds=120,
            external_video_url="https://youtube.com/watch?v=abc123",
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
    mock_load_cached.assert_called_once_with(
        creator_id="creator-001",
        vlog_id="vlog-001",
        source_video_url="https://youtube.com/watch?v=abc123",
        timestamps_sec=[30.0, 90.0],
    )
    mock_extract_frame.assert_called_once_with(
        "https://youtube.com/watch?v=abc123",
        [30.0, 90.0],
    )
    assert mock_store_frame.call_count == 2
    assert mock_write_manifest.call_count == 1

    frame_inserts = [params for sql, params in fake_pg.cursor.queries if 'INSERT INTO "FrameAsset"' in sql]
    assert frame_inserts[0][4] == "creators/creator-001/vlogs/vlog-001/frames/frame-000030.jpg"
    assert frame_inserts[1][4] == "creators/creator-001/vlogs/vlog-001/frames/frame-000090.jpg"
    first_call = mock_store_frame.call_args_list[0].kwargs
    assert first_call["frame_content"] == b"frame-30"
    assert first_call["frame_content_type"] == "image/jpeg"


def test_sync_visual_evidence_clears_previous_visual_rows_before_reinserting():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg):
        from app.services.visual_evidence_service import sync_visual_evidence

        with patch(
            "app.services.visual_evidence_service.load_cached_frame_assets",
            return_value={},
        ), patch(
            "app.services.visual_evidence_service.extract_video_frames",
            return_value={},
        ), patch(
            "app.services.visual_evidence_service.store_frame_asset",
            return_value=type("StoredFrame", (), {"path": "creators/creator-001/vlogs/vlog-001/frames/frame-000015.jpg"})(),
        ):
            sync_visual_evidence("vlog-001", "creator-001", "Tokyo vlog", duration_seconds=45)

    sql_statements = [query for query, _params in fake_pg.cursor.queries[:4]]
    assert 'DELETE FROM "OpportunityEvidence"' in sql_statements[0]
    assert 'DELETE FROM "Evidence"' in sql_statements[1]
    assert 'DELETE FROM "FrameAsset"' in sql_statements[2]
    assert 'DELETE FROM "SceneSegment"' in sql_statements[3]


def test_sync_visual_evidence_reuses_cached_frames_without_reextracting():
    fake_pg = FakePgClient(rows=[])
    cached_frame = type(
        "StoredFrame",
        (),
        {
            "path": "creators/creator-001/vlogs/vlog-001/frames/frame-000030.jpg",
            "content_type": "image/jpeg",
            "size_bytes": 123,
        },
    )()

    with (
        patch("app.services.visual_evidence_service.PgClient", return_value=fake_pg),
        patch(
            "app.services.visual_evidence_service.load_cached_frame_assets",
            return_value={30.0: cached_frame},
        ),
        patch("app.services.visual_evidence_service.extract_video_frames", return_value={}) as mock_extract_frame,
        patch("app.services.visual_evidence_service.store_frame_asset") as mock_store_frame,
        patch("app.services.visual_evidence_service.write_frame_manifest") as mock_write_manifest,
    ):
        from app.services.visual_evidence_service import sync_visual_evidence

        result = sync_visual_evidence(
            "vlog-001",
            "creator-001",
            "Tokyo vlog",
            duration_seconds=60,
            external_video_url="https://youtube.com/watch?v=abc123",
        )

    assert result == {"scene_segments": 1, "frame_assets": 1, "evidences": 1}
    mock_extract_frame.assert_called_once_with("https://youtube.com/watch?v=abc123", [])
    mock_store_frame.assert_not_called()
    mock_write_manifest.assert_called_once()
