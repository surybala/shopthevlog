"""
Tests for app.api.v1.webhooks — POST /api/v1/webhooks/scan/trigger.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from tests.conftest import FakePgClient
from app.core.security import UserClaims


def _make_client(pg_factory=None, user_id="user-001") -> TestClient:
    from app.main import app
    from app.core.security import get_current_user
    fake_user = UserClaims(user_id=user_id, email="test@example.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user
    return TestClient(app, raise_server_exceptions=False)


def _restore():
    from app.main import app
    app.dependency_overrides.clear()


class TestTriggerScan:
    def teardown_method(self, _):
        _restore()

    def test_returns_zero_when_no_pending_vlogs(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.webhooks.PgClient", return_value=pg):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")
        assert resp.status_code == 200
        assert resp.json()["queued"] == 0

    def test_returns_message_when_no_vlogs(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.webhooks.PgClient", return_value=pg):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")
        assert "message" in resp.json()

    def test_queues_pending_vlogs(self):
        first_pg = FakePgClient(rows=[{"id": "vlog-1"}, {"id": "vlog-2"}])
        second_pg = FakePgClient(rows=[])

        call_count = {"n": 0}

        def _pg_factory():
            call_count["n"] += 1
            return first_pg if call_count["n"] == 1 else second_pg

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=_pg_factory),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.status_code == 200
        assert resp.json()["queued"] == 2

    def test_returns_vlog_ids_in_response(self):
        first_pg = FakePgClient(rows=[{"id": "vlog-A"}, {"id": "vlog-B"}])
        second_pg = FakePgClient(rows=[])
        call_count = {"n": 0}

        def _pg_factory():
            call_count["n"] += 1
            return first_pg if call_count["n"] == 1 else second_pg

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=_pg_factory),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        data = resp.json()
        assert "vlog_ids" in data
        assert set(data["vlog_ids"]) == {"vlog-A", "vlog-B"}

    def test_marks_vlogs_as_queued(self):
        first_pg = FakePgClient(rows=[{"id": "vlog-X"}])
        second_pg = FakePgClient(rows=[])
        call_count = {"n": 0}

        def _pg_factory():
            call_count["n"] += 1
            return first_pg if call_count["n"] == 1 else second_pg

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=_pg_factory),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            client.post("/api/v1/webhooks/scan/trigger")

        # Second PgClient should have had UPDATE executed
        queries = [q[0] for q in second_pg.cursor.queries]
        assert any("QUEUED" in q for q in queries)

    def test_requires_authentication(self):
        from app.main import app
        # No dependency override — real auth will fail
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/api/v1/webhooks/scan/trigger")
        assert resp.status_code == 401

    def test_adds_background_task_per_vlog(self):
        first_pg = FakePgClient(rows=[{"id": "vlog-1"}, {"id": "vlog-2"}, {"id": "vlog-3"}])
        second_pg = FakePgClient(rows=[])
        call_count = {"n": 0}

        def _pg_factory():
            call_count["n"] += 1
            return first_pg if call_count["n"] == 1 else second_pg

        added_tasks = []
        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=_pg_factory),
            patch("app.api.v1.webhooks.process_vlog_task") as mock_task,
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.json()["queued"] == 3

    def test_single_vlog_queued(self):
        first_pg = FakePgClient(rows=[{"id": "only-vlog"}])
        second_pg = FakePgClient(rows=[])
        call_count = {"n": 0}

        def _pg_factory():
            call_count["n"] += 1
            return first_pg if call_count["n"] == 1 else second_pg

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=_pg_factory),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.json()["queued"] == 1
        assert resp.json()["vlog_ids"] == ["only-vlog"]
