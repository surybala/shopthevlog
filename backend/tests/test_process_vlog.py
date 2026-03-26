"""
Tests for app.tasks.process_vlog — the transcribe → generate → rebuild pipeline.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


# ─── module under test ───────────────────────────────────────────────────────
from app.tasks.process_vlog import process_vlog_task

# build_feed_for_user is imported INSIDE process_vlog_task's function body
# (not as a module-level import), so it must be patched at the source module.
_FEED_PATCH = "app.services.feed_ranking_service.build_feed_for_user"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_db(status: str | None, title: str = "Test Vlog") -> MagicMock:
    db = MagicMock()
    # Counts scoped at the db level so they survive across .table() calls.
    _vlogs_calls = [0]

    def table_side_effect(name):
        t = MagicMock()
        for m in ("select", "eq", "update", "single", "limit", "filter"):
            getattr(t, m).return_value = t

        if name == "vlogs":
            def execute_vlogs():
                idx = _vlogs_calls[0]
                _vlogs_calls[0] += 1
                if idx == 0:
                    # status check (.single().execute())
                    return MagicMock(data={"processing_status": status})
                if idx == 1:
                    # title fetch (.single().execute())
                    return MagicMock(data={"title": title})
                return MagicMock(data=[])   # update / other calls

            t.execute.side_effect = execute_vlogs

        elif name == "profiles":
            t.execute.return_value = MagicMock(data=[{"id": "u1"}, {"id": "u2"}])

        else:
            t.execute.return_value = MagicMock(data=[])

        return t

    db.table.side_effect = table_side_effect
    return db


# ─────────────────────────────────────────────────────────────────────────────
# Duplicate / in-flight guards
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessVlogGuards:
    @pytest.mark.asyncio
    async def test_already_transcribing_is_skipped(self):
        db = _make_db(status="transcribing")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_ready_is_skipped(self):
        db = _make_db(status="ready")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog") as mock_transcribe,
        ):
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_planning_status_proceeds(self):
        """'planning' is queued-but-not-started — must NOT be skipped."""
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript text") as mock_transcribe,
            patch("app.tasks.process_vlog.generate_itinerary", return_value=True),
            patch(_FEED_PATCH),
        ):
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_called_once_with("vlog-001")

    @pytest.mark.asyncio
    async def test_pending_status_proceeds(self):
        db = _make_db(status="pending")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.generate_itinerary", return_value=True),
            patch(_FEED_PATCH),
        ):
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_called_once()

    @pytest.mark.asyncio
    async def test_none_status_proceeds(self):
        """If the vlog row is missing or status is null, task should still run."""
        db = _make_db(status=None)
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript") as mock_transcribe,
            patch("app.tasks.process_vlog.generate_itinerary", return_value=True),
            patch(_FEED_PATCH),
        ):
            await process_vlog_task("vlog-001")
            mock_transcribe.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: transcription failure
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessVlogTranscription:
    @pytest.mark.asyncio
    async def test_transcription_failure_aborts_pipeline(self):
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value=None),
            patch("app.tasks.process_vlog.generate_itinerary") as mock_gen,
        ):
            await process_vlog_task("vlog-001")
            mock_gen.assert_not_called()

    @pytest.mark.asyncio
    async def test_transcription_failure_does_not_set_failed_status(self):
        """transcribe_vlog sets the status itself; process_vlog_task just returns."""
        db = _make_db(status="planning")
        failed_updates: list[str] = []
        original = db.table.side_effect

        def capturing(name):
            t = original(name)
            if name == "vlogs":
                _t = t

                def track(data):
                    if data.get("processing_status") == "failed":
                        failed_updates.append("failed")
                    return _t  # return for chaining — avoids recursive side_effect

                t.update.side_effect = track
            return t

        db.table.side_effect = capturing

        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value=None),
            patch("app.tasks.process_vlog.generate_itinerary"),
        ):
            await process_vlog_task("vlog-001")

        assert not failed_updates

    @pytest.mark.asyncio
    async def test_status_stamped_transcribing_before_work_starts(self):
        """The task must update status to 'transcribing' immediately."""
        db = _make_db(status="planning")
        stamped: list[bool] = []
        original = db.table.side_effect

        def capturing(name):
            t = original(name)
            if name == "vlogs":
                _t = t

                def track(data):
                    if data.get("processing_status") == "transcribing":
                        stamped.append(True)
                    return _t

                t.update.side_effect = track
            return t

        db.table.side_effect = capturing

        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value=None),
        ):
            await process_vlog_task("vlog-001")

        assert stamped, "Expected processing_status to be set to 'transcribing'"


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: itinerary generation failure
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessVlogItineraryGeneration:
    @pytest.mark.asyncio
    async def test_itinerary_failure_aborts_feed_rebuild(self):
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript"),
            patch("app.tasks.process_vlog.generate_itinerary", return_value=False),
            patch(_FEED_PATCH) as mock_feed,
        ):
            await process_vlog_task("vlog-001")
            mock_feed.assert_not_called()

    @pytest.mark.asyncio
    async def test_success_rebuilds_feed_for_all_users(self):
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript"),
            patch("app.tasks.process_vlog.generate_itinerary", return_value=True),
            patch(_FEED_PATCH) as mock_feed,
        ):
            await process_vlog_task("vlog-001")

        # Two users in mock profiles table → should rebuild both feeds
        assert mock_feed.call_count == 2
        called_user_ids = {c.args[0] for c in mock_feed.call_args_list}
        assert called_user_ids == {"u1", "u2"}

    @pytest.mark.asyncio
    async def test_feed_rebuild_failure_does_not_crash_task(self):
        """A failure in one user's feed rebuild must not propagate as an exception."""
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", return_value="transcript"),
            patch("app.tasks.process_vlog.generate_itinerary", return_value=True),
            patch(_FEED_PATCH, side_effect=RuntimeError("DB down")),
        ):
            # Must not raise
            await process_vlog_task("vlog-001")


# ─────────────────────────────────────────────────────────────────────────────
# Unexpected exception handling
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessVlogExceptionHandling:
    @pytest.mark.asyncio
    async def test_unexpected_exception_sets_failed_status(self):
        db = _make_db(status="planning")
        failed_updates: list[dict] = []
        original = db.table.side_effect

        def capturing(name):
            t = original(name)
            if name == "vlogs":
                _t = t

                def track(data):
                    if data.get("processing_status") == "failed":
                        failed_updates.append(data)
                    return _t

                t.update.side_effect = track
            return t

        db.table.side_effect = capturing

        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", side_effect=RuntimeError("boom")),
        ):
            await process_vlog_task("vlog-001")

        assert failed_updates, "Expected processing_status='failed' to be set on unexpected error"
        assert failed_updates[0]["processing_error"] == "boom"

    @pytest.mark.asyncio
    async def test_unexpected_exception_does_not_propagate(self):
        db = _make_db(status="planning")
        with (
            patch("app.tasks.process_vlog.get_supabase", return_value=db),
            patch("app.tasks.process_vlog.transcribe_vlog", side_effect=ValueError("bad value")),
        ):
            # Must not raise — errors are caught and logged internally
            await process_vlog_task("vlog-001")
