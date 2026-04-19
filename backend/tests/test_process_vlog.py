"""
Tests for app.tasks.process_vlog.

The graph pipeline now stops at review readiness:
transcribe -> sync transcript graph -> rank opportunities -> REVIEW_PENDING.
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
        "externalUrl": "https://youtube.com/watch?v=abc123",
        "hasOpportunities": False,
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

    @pytest.mark.asyncio
    async def test_existing_opportunities_skip_reprocessing(self):
        pg = FakePgClient(rows=[{
            "id": "vlog-001",
            "processingStatus": "FAILED",
            "creatorId": "creator-001",
            "title": "Test Vlog",
            "durationSeconds": 420,
            "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
            "externalUrl": "https://youtube.com/watch?v=abc123",
            "hasOpportunities": True,
        }])
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_transcribe.assert_not_called()


class TestPhaseOnePipeline:
    @pytest.mark.asyncio
    async def test_pending_status_runs_transcript_graph_visual_sync_then_review_pending(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="full transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 2}) as mock_sync_graph,
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}) as mock_visual_sync,
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 1}) as mock_visual_enrich,
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}) as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}) as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 2}) as mock_rank,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_transcribe.assert_called_once_with("vlog-001")
        mock_sync_graph.assert_called_once_with(
            "vlog-001",
            "creator-001",
            "Test Vlog",
            "full transcript",
            duration_seconds=420,
        )
        mock_visual_sync.assert_called_once_with(
            "vlog-001",
            "creator-001",
            "Test Vlog",
            duration_seconds=420,
            external_video_url="https://youtube.com/watch?v=abc123",
            thumbnail_url="https://cdn.example.com/thumb.jpg",
        )
        mock_visual_enrich.assert_called_once_with("vlog-001", "creator-001", "Test Vlog")
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

    @pytest.mark.asyncio
    async def test_no_opportunities_marks_vlog_failed_instead_of_review_pending(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="quiet transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 0}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 0}),
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 0}),
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
            patch("app.tasks.process_vlog._update_vlog_pipeline_error") as mock_pipeline_error,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")
        mock_pipeline_error.assert_called_once_with("vlog-001", "no_opportunities_extracted")
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "VISION_DONE"),
        ])

    @pytest.mark.asyncio
    async def test_missing_vlog_duration_falls_back_to_transcript_segment_estimate_for_visual_sampling(self):
        pg = FakePgClient(rows=[{
            "id": "vlog-001",
            "processingStatus": "PENDING",
            "creatorId": "creator-001",
            "title": "Test Vlog",
            "durationSeconds": None,
            "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
            "externalUrl": "https://youtube.com/watch?v=abc123",
            "hasOpportunities": False,
        }])
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="full transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 2, "segments": 15}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}) as mock_visual_sync,
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}),
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}),
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 2}),
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_visual_sync.assert_called_once_with(
            "vlog-001",
            "creator-001",
            "Test Vlog",
            duration_seconds=450,
            external_video_url="https://youtube.com/watch?v=abc123",
            thumbnail_url="https://cdn.example.com/thumb.jpg",
        )

    @pytest.mark.asyncio
    async def test_failed_status_can_retry(self):
        pg = _make_vlog_pg("FAILED")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="retry transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 1}),
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}),
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 1}),
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 1}),
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
            patch("app.tasks.process_vlog.enrich_visual_graph") as mock_visual_enrich,
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_sync_graph.assert_not_called()
        mock_visual_sync.assert_not_called()
        mock_visual_enrich.assert_not_called()
        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()

    @pytest.mark.asyncio
    async def test_graph_failure_aborts_review_pipeline(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", side_effect=RuntimeError("graph write failed")),
            patch("app.tasks.process_vlog.sync_visual_evidence") as mock_visual_sync,
            patch("app.tasks.process_vlog.enrich_visual_graph") as mock_visual_enrich,
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
        mock_visual_sync.assert_not_called()
        mock_visual_enrich.assert_not_called()
        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_visual_evidence_failure_is_recorded_but_publish_continues(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", side_effect=RuntimeError("ffmpeg unavailable")),
            patch("app.tasks.process_vlog.enrich_visual_graph") as mock_visual_enrich,
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 2}) as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 2}) as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 3}) as mock_rank,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
            patch("app.tasks.process_vlog._update_vlog_pipeline_error") as mock_pipeline_error,
            patch("app.tasks.process_vlog.observability_store.record") as mock_record,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_pipeline_error.assert_called_once_with("vlog-001", "visual_storage_failed: ffmpeg unavailable")
        mock_visual_enrich.assert_not_called()
        mock_fuse.assert_called_once_with("vlog-001")
        mock_resolve.assert_called_once_with("vlog-001")
        mock_rank.assert_called_once_with("vlog-001")
        assert any(
            call.kwargs.get("name") == "process_vlog.visual_storage"
            and call.kwargs.get("status") == "failed"
            for call in mock_record.call_args_list
        )
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "FUSED"),
            call("vlog-001", "RESOLVED"),
            call("vlog-001", "RANKED"),
            call("vlog-001", "REVIEW_PENDING"),
        ])

    @pytest.mark.asyncio
    async def test_visual_failure_plus_no_transcript_opportunities_marks_failed(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 0}),
            patch("app.tasks.process_vlog.sync_visual_evidence", side_effect=RuntimeError("Invalid API key")),
            patch("app.tasks.process_vlog.enrich_visual_graph") as mock_visual_enrich,
            patch("app.tasks.process_vlog.fuse_candidate_entities") as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
            patch("app.tasks.process_vlog._update_vlog_pipeline_error") as mock_pipeline_error,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
            patch("app.tasks.process_vlog.observability_store.record") as mock_record,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_visual_enrich.assert_not_called()
        mock_fuse.assert_not_called()
        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")
        assert mock_pipeline_error.call_args_list == [
            call("vlog-001", "visual_storage_failed: Invalid API key"),
            call("vlog-001", "no_opportunities_extracted; visual_storage_failed: Invalid API key"),
        ]
        assert any(
            call.kwargs.get("name") == "process_vlog.visual_storage"
            and call.kwargs.get("detail") == "visual_storage_credentials"
            for call in mock_record.call_args_list
        )
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
        ])

    @pytest.mark.asyncio
    async def test_visual_enrichment_failure_is_logged_separately_from_storage(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 2}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.enrich_visual_graph", side_effect=RuntimeError("Gemini API key rejected")),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 1}) as mock_fuse,
            patch("app.tasks.process_vlog.resolve_candidates", return_value={"resolved": 1}) as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities", return_value={"ranked": 2}) as mock_rank,
            patch("app.tasks.process_vlog._update_vlog_status") as mock_update_status,
            patch("app.tasks.process_vlog._update_vlog_pipeline_error") as mock_pipeline_error,
            patch("app.tasks.process_vlog.observability_store.record") as mock_record,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_pipeline_error.assert_called_once_with("vlog-001", "visual_enrichment_failed: Gemini API key rejected")
        mock_fuse.assert_called_once_with("vlog-001")
        mock_resolve.assert_called_once_with("vlog-001")
        mock_rank.assert_called_once_with("vlog-001")
        assert any(
            call.kwargs.get("name") == "process_vlog.visual_enrichment"
            and call.kwargs.get("detail") == "visual_enrichment_gemini"
            for call in mock_record.call_args_list
        )
        mock_update_status.assert_has_calls([
            call("vlog-001", "TRANSCRIPT_DONE"),
            call("vlog-001", "FUSED"),
            call("vlog-001", "RESOLVED"),
            call("vlog-001", "RANKED"),
            call("vlog-001", "REVIEW_PENDING"),
        ])

    @pytest.mark.asyncio
    async def test_fusion_failure_aborts_resolution_and_ranking(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", side_effect=RuntimeError("fusion exploded")),
            patch("app.tasks.process_vlog.resolve_candidates") as mock_resolve,
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_resolve.assert_not_called()
        mock_rank.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_resolution_failure_aborts_ranking(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="graph transcript"),
            patch("app.tasks.process_vlog.sync_transcript_graph", return_value={"opportunities": 3}),
            patch("app.tasks.process_vlog.sync_visual_evidence", return_value={"scene_segments": 3}),
            patch("app.tasks.process_vlog.enrich_visual_graph", return_value={"opportunities": 1}),
            patch("app.tasks.process_vlog.fuse_candidate_entities", return_value={"clusters": 2}),
            patch("app.tasks.process_vlog.resolve_candidates", side_effect=RuntimeError("resolver exploded")),
            patch("app.tasks.process_vlog.rank_opportunities") as mock_rank,
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_rank.assert_not_called()
        mock_mark_failed.assert_called_once_with("vlog-001")


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
