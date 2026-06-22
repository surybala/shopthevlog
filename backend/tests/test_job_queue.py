"""
Tests for the durable Postgres-backed job queue and worker dispatch.

DB access is mocked via FakePgClient; the SQL is exercised for shape/params.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import FakePgClient


# ─── enqueue ──────────────────────────────────────────────────────────────────

class TestEnqueue:
    def test_inserts_and_returns_id(self):
        client = FakePgClient(rows=[{"id": "job-1"}])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import enqueue
            job_id = enqueue("analyze_channel", {"creator_id": "c1", "creator_handle": "h"})
        assert job_id == "job-1"
        sql, params = client.cursor.queries[0]
        assert 'INSERT INTO "Job"' in sql
        assert params[0] == "analyze_channel"
        assert json.loads(params[1]) == {"creator_id": "c1", "creator_handle": "h"}

    def test_returns_none_on_error(self):
        with patch("app.services.job_queue.PgClient", side_effect=RuntimeError("db down")):
            from app.services.job_queue import enqueue
            assert enqueue("process_vlog", {"vlog_id": "v1"}) is None

    def test_passes_run_after_and_max_attempts(self):
        client = FakePgClient(rows=[{"id": "job-2"}])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import enqueue
            enqueue("process_vlog", {"vlog_id": "v1"}, max_attempts=5, run_after_seconds=30)
        _, params = client.cursor.queries[0]
        assert params[2] == 5
        assert params[3] == 30


# ─── claim_next ───────────────────────────────────────────────────────────────

class TestClaimNext:
    def test_returns_none_when_empty(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import claim_next
            assert claim_next("worker-1") is None

    def test_claims_and_parses_job(self):
        client = FakePgClient(rows=[{
            "id": "job-1", "type": "process_vlog",
            "payload": json.dumps({"vlog_id": "v1"}),
            "attempts": 1, "maxAttempts": 3,
        }])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import claim_next
            job = claim_next("worker-1")
        assert job["id"] == "job-1"
        assert job["type"] == "process_vlog"
        assert job["payload"] == {"vlog_id": "v1"}
        assert job["attempts"] == 1
        # Uses SKIP LOCKED for safe concurrent claiming
        assert "FOR UPDATE SKIP LOCKED" in client.cursor.queries[0][0]

    def test_handles_dict_payload(self):
        client = FakePgClient(rows=[{
            "id": "job-1", "type": "process_vlog",
            "payload": {"vlog_id": "v1"},  # already-parsed
            "attempts": 1, "maxAttempts": 3,
        }])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import claim_next
            job = claim_next("worker-1")
        assert job["payload"] == {"vlog_id": "v1"}


# ─── success / failure / retry ────────────────────────────────────────────────

class TestMarkOutcome:
    def test_mark_succeeded(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import mark_succeeded
            mark_succeeded("job-1")
        assert "SUCCEEDED" in client.cursor.queries[0][0]

    def test_mark_failed_requeues_when_attempts_remain(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import mark_failed
            status = mark_failed("job-1", "boom", attempts=1, max_attempts=3)
        assert status == "PENDING"
        assert "PENDING" in client.cursor.queries[0][0]
        assert "runAfter" in client.cursor.queries[0][0]

    def test_mark_failed_gives_up_when_exhausted(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import mark_failed
            status = mark_failed("job-1", "boom", attempts=3, max_attempts=3)
        assert status == "FAILED"
        assert "FAILED" in client.cursor.queries[0][0]

    def test_mark_failed_truncates_long_error(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import mark_failed
            mark_failed("job-1", "x" * 5000, attempts=3, max_attempts=3)
        _, params = client.cursor.queries[0]
        assert len(params[0]) <= 1000


# ─── reaper ───────────────────────────────────────────────────────────────────

class TestReapStale:
    def test_reaps_and_returns_count(self):
        client = FakePgClient(rows=[{"id": "job-1"}, {"id": "job-2"}])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import reap_stale
            count = reap_stale(stale_seconds=900)
        assert count == 2
        assert "RUNNING" in client.cursor.queries[0][0]

    def test_returns_zero_when_nothing_stale(self):
        client = FakePgClient(rows=[])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import reap_stale
            assert reap_stale() == 0


# ─── worker dispatch ──────────────────────────────────────────────────────────

class TestWorker:
    @pytest.mark.asyncio
    async def test_run_job_dispatches_analyze_and_marks_success(self):
        job = {"id": "j1", "type": "analyze_channel", "payload": {"creator_id": "c1", "creator_handle": "h"}, "attempts": 1, "maxAttempts": 3}
        with (
            patch("app.worker.analyze_channel_task", new=AsyncMock()) as mock_task,
            patch("app.worker.job_queue.mark_succeeded") as mock_done,
        ):
            from app.worker import run_job
            ok = await run_job(job)
        assert ok is True
        mock_task.assert_awaited_once_with("c1", "h")
        mock_done.assert_called_once_with("j1")

    @pytest.mark.asyncio
    async def test_run_job_dispatches_process_vlog(self):
        job = {"id": "j2", "type": "process_vlog", "payload": {"vlog_id": "v1"}, "attempts": 1, "maxAttempts": 3}
        with (
            patch("app.worker.process_vlog_task", new=AsyncMock()) as mock_task,
            patch("app.worker.job_queue.mark_succeeded") as mock_done,
        ):
            from app.worker import run_job
            ok = await run_job(job)
        assert ok is True
        mock_task.assert_awaited_once_with("v1")
        mock_done.assert_called_once_with("j2")

    @pytest.mark.asyncio
    async def test_run_job_marks_failed_on_handler_error(self):
        job = {"id": "j3", "type": "process_vlog", "payload": {"vlog_id": "v1"}, "attempts": 1, "maxAttempts": 3}
        with (
            patch("app.worker.process_vlog_task", new=AsyncMock(side_effect=RuntimeError("kaboom"))),
            patch("app.worker.job_queue.mark_failed", return_value="PENDING") as mock_fail,
        ):
            from app.worker import run_job
            ok = await run_job(job)
        assert ok is False
        mock_fail.assert_called_once()
        assert mock_fail.call_args[0][0] == "j3"

    @pytest.mark.asyncio
    async def test_run_job_unknown_type_fails_permanently(self):
        job = {"id": "j4", "type": "mystery", "payload": {}, "attempts": 1, "maxAttempts": 3}
        with patch("app.worker.job_queue.mark_failed", return_value="FAILED") as mock_fail:
            from app.worker import run_job
            ok = await run_job(job)
        assert ok is False
        # exhausted immediately (attempts == maxAttempts so no retry)
        assert mock_fail.call_args[0][2] == mock_fail.call_args[0][3]

    @pytest.mark.asyncio
    async def test_work_once_returns_false_when_idle(self):
        with patch("app.worker.job_queue.claim_next", return_value=None):
            from app.worker import work_once
            assert await work_once("worker-1") is False

    @pytest.mark.asyncio
    async def test_work_once_processes_a_job(self):
        job = {"id": "j5", "type": "process_vlog", "payload": {"vlog_id": "v1"}, "attempts": 1, "maxAttempts": 3}
        with (
            patch("app.worker.job_queue.claim_next", return_value=job),
            patch("app.worker.process_vlog_task", new=AsyncMock()),
            patch("app.worker.job_queue.mark_succeeded"),
        ):
            from app.worker import work_once
            assert await work_once("worker-1") is True


class TestClaimPayloadFallback:
    def test_invalid_json_payload_becomes_empty_dict(self):
        client = FakePgClient(rows=[{
            "id": "job-x", "type": "process_vlog",
            "payload": "not valid json",
            "attempts": 1, "maxAttempts": 3,
        }])
        with patch("app.services.job_queue.PgClient", return_value=client):
            from app.services.job_queue import claim_next
            job = claim_next("worker-1")
        assert job["payload"] == {}


class TestRunForever:
    @pytest.mark.asyncio
    async def test_idle_loop_reaps_and_sleeps_then_exits(self):
        import asyncio

        async def fake_work_once(_wid):
            return False

        async def fake_sleep(_s):
            raise asyncio.CancelledError()

        with (
            patch("app.worker.work_once", side_effect=fake_work_once),
            patch("app.worker.asyncio.sleep", side_effect=fake_sleep),
            patch("app.worker.job_queue.reap_stale") as mock_reap,
        ):
            from app.worker import run_forever
            with pytest.raises(asyncio.CancelledError):
                await run_forever(worker_id="w1", poll_interval=1, reap_every=0)
        mock_reap.assert_called()
