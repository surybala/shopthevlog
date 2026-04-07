"""
Tests for app.tasks.process_vlog — the transcribe → generate TripKit pipeline.

All external calls (PostgreSQL, Gemini, Whisper) are fully mocked via the
FakePgClient from conftest.py and unittest.mock patches.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import FakePgClient


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_vlog_pg(status: str, title: str = "Test Vlog") -> FakePgClient:
    """PgClient whose first fetchone returns a vlog row with the given status."""
    return FakePgClient(rows=[{
        "id": "vlog-001",
        "processingStatus": status,
        "creatorId": "creator-001",
        "title": title,
    }])


def _make_empty_pg() -> FakePgClient:
    """PgClient that returns no rows (used for UPDATE calls)."""
    return FakePgClient(rows=[])


# ─────────────────────────────────────────────────────────────────────────────
# Guard conditions — already in a terminal / in-progress state
# ─────────────────────────────────────────────────────────────────────────────

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
    async def test_pending_status_proceeds(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.generate_trip_kit", return_value=True),
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_failed_status_proceeds(self):
        """FAILED vlogs should be retried."""
        pg = _make_vlog_pg("FAILED")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.generate_trip_kit", return_value=True),
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_vlog_not_found_returns_early(self):
        """If the vlog row doesn't exist, return without touching anything."""
        pg = FakePgClient(rows=[])   # fetchone → None
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-does-not-exist")
            mock_transcribe.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# Transcription step
# ─────────────────────────────────────────────────────────────────────────────

class TestTranscriptionStep:

    @pytest.mark.asyncio
    async def test_transcription_failure_aborts_pipeline(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value=None),
            patch("app.tasks.process_vlog.generate_trip_kit") as mock_gen,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
            mock_gen.assert_not_called()

    @pytest.mark.asyncio
    async def test_transcription_success_calls_generate(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="full transcript"),
            patch("app.tasks.process_vlog.generate_trip_kit", return_value=True) as mock_gen,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")
            mock_gen.assert_called_once_with(
                "vlog-001", "full transcript", "Test Vlog", "creator-001"
            )

    @pytest.mark.asyncio
    async def test_generate_failure_logged_but_does_not_propagate(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript"),
            patch("app.tasks.process_vlog.generate_trip_kit", return_value=False),
        ):
            from app.tasks.process_vlog import process_vlog_task
            # Must not raise
            await process_vlog_task("vlog-001")


# ─────────────────────────────────────────────────────────────────────────────
# Exception handling
# ─────────────────────────────────────────────────────────────────────────────

class TestExceptionHandling:

    @pytest.mark.asyncio
    async def test_unexpected_exception_does_not_propagate(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog",
                  side_effect=RuntimeError("unexpected boom")),
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            # Must not raise
            await process_vlog_task("vlog-001")

        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_mark_failed_called_on_exception(self):
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog",
                  side_effect=ValueError("bad data")),
            patch("app.tasks.process_vlog._mark_vlog_failed") as mock_mark_failed,
        ):
            from app.tasks.process_vlog import process_vlog_task
            await process_vlog_task("vlog-001")

        mock_mark_failed.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_mark_failed_error_itself_does_not_propagate(self):
        """Even if _mark_vlog_failed crashes, the task should swallow the error."""
        pg = _make_vlog_pg("PENDING")
        with (
            patch("app.tasks.process_vlog.PgClient", return_value=pg),
            patch("app.tasks.process_vlog.transcribe_vlog",
                  side_effect=RuntimeError("boom")),
            patch("app.tasks.process_vlog._mark_vlog_failed",
                  side_effect=RuntimeError("db also down")),
        ):
            from app.tasks.process_vlog import process_vlog_task
            # Must still not raise
            await process_vlog_task("vlog-001")
