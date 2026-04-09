"""
Tests for app.tasks.process_vlog.

Phase 1 now builds the transcript graph before keeping the legacy TripKit
projection step alive, so the task ordering is:
transcribe -> sync transcript graph -> publish TripKit projection.
"""
import pytest
from unittest.mock import call, patch

from tests.conftest import FakePgClient


def _make_vlog_pg(status: str, title: str = "Test Vlog") -> FakePgClient:
    return FakePgClient(rows=[{
        "id": "vlog-001",
        "processingStatus": status,
        "creatorId": "creator-001",
        "title": title,
        "durationSeconds": 420,
        "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
    }])


class TestProcessVlogGuards:
    @pytest.mark.asyncio
    async def test_already_transcribing_is_skipped(self):
        pg = _make_vlog_pg("TRANSCRIBING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_extracting_is_skipped(self):
        pg = _make_vlog_pg("EXTRACTING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_complete_is_skipped(self):
        pg = _make_vlog_pg("COMPLETE")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_review_pending_is_skipped(self):
        pg = _make_vlog_pg("REVIEW_PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_published_is_skipped(self):
        pg = _make_vlog_pg("PUBLISHED")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_vlog_not_found_returns_early(self):
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=FakePgClient(rows=[])),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("missing-vlog")
        mock_transcribe.assert_not_called()


class TestPhaseOnePipeline:
    @pytest.mark.asyncio
    async def test_pending_status_runs_transcript_graph_visual_sync_then_tripkit_projection(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="full transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 2}) as mock_sync_graph,
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}) as mock_visual_sync,
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}) as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}) as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 2}) as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph", return_value=True) as mock_publish_tripkit,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_transcribe.assert_called_once_with("vlog-001")
        mock_sync_graph.assert_called_once_with("vlog-001", "creator-001", "Test Vlog", "full transcript")
        mock_visual_sync.assert_called_once_with(
            "vlog-001",
            "Test Vlog",
            duration_seconds=420,
            thumbnail_url="https://cdn.example.com/thumb.jpg",
        )
        mock_fuse.assert_called_once_with("vlog-001")
        mock_resolve.assert_called_once_with("vlog-001")
        mock_rank.assert_called_once_with("vlog-001")
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "VISION_DONE"),
            call("vlog-001", "FUSED"),
            call("vlog-001", "RESOLVED"),
            call("vlog-001", "RANKED"),
            call("vlog-001", "REVIEW_PENDING"),
        ])
        mock_publish_tripkit.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_failed_status_can_retry(self):
        pg = _make_vlog_pg("FAILED")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="retry transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 1}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}),
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 1}),
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 1}),
            patch("app.tasks.process_vlog.publish_tripkit_from_graph", return_value=True),
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_transcription_failure_aborts_downstream_steps(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value=None),
            patch("app.tasks.process_vlog.sync_transcript_graph") as mock_sync_graph,
            patch("app.tasks.process_vlog.sync_visual_evidence") as mock_visual_sync,
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph") as mock_publish_tripkit,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_sync_graph.assert_not_called()
        mock_visual_sync.assert_not_called()
        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_publish_tripkit.assert_not_called()

    @pytest.mark.asyncio
    async def test_graph_failure_aborts_tripkit_projection(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", side_effect=RuntimeError("graph write failed")),
            patch("app.tasks.process_vlog.sync_visual_evidence") as mock_visual_sync,
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph") as mock_publish_tripkit,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_visual_sync.assert_not_called()
        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_publish_tripkit.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_visual_evidence_failure_is_recorded_but_publish_continues(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", side_effect=RuntimeError("ffmpeg unavailable")),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 2}) as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}) as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 3}) as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph", return_value=True) as mock_publish_tripkit,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
            patch("app.tasks.process_vlog._update_vlog_pipeline_error") as mock_pipeline_error,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_pipeline_error.assert_called_once_with("vlog-001", "visual_evidence_failed: ffmpeg unavailable")
        mock_fuse.assert_called_once_with("vlog-001")
        mock_resolve.assert_called_once_with("vlog-001")
        mock_rank.assert_called_once_with("vlog-001")
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "FUSED"),
            call("vlog-001", "RESOLVED"),
            call("vlog-001", "RANKED"),
            call("vlog-001", "REVIEW_PENDING"),
        ])
        mock_publish_tripkit.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_fusion_failure_aborts_resolution_ranking_and_publish(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", side_effect=RuntimeError("fusion exploded")),
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph") as mock_publish_tripkit,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_publish_tripkit.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_resolution_failure_aborts_ranking_and_publish(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 2}),
            patch("app.tasks.process_vlog.resolve_candidates", side_effect=RuntimeError("resolver exploded")),
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog.publish_tripkit_from_graph") as mock_publish_tripkit,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_rank.assert_not_called()
        mock_publish_tripkit.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_tripkit_projection_failure_is_swallowed(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 2}),
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}),
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 3}),
            patch("app.tasks.process_vlog.publish_tripkit_from_graph", return_value=False),
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "VISION_DONE"),
            call("vlog-001", "FUSED"),
            call("vlog-001", "RESOLVED"),
            call("vlog-001", "RANKED"),
            call("vlog-001", "REVIEW_PENDING"),
        ])


class TestExceptionHandling:
    @pytest.mark.asyncio
    async def test_unexpected_exception_marks_vlog_failed(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", side_effect=RuntimeError("unexpected boom")),
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_mark_failed_error_itself_does_not_propagate(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", side_effect=RuntimeError("boom")),
            patch("app.tasks.process_vlog._mark_vlog_failed", side_effect=RuntimeError("db also down")),
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
