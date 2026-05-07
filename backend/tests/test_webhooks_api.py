"""
Tests for app.api.v1.webhooks — POST /api/v1/webhooks/scan/trigger.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from tests.conftest import FakePgClient
from app.core.security import UserClaims
from app.services.quota_service import QuotaResult


def _allowed_quota() -> QuotaResult:
    return QuotaResult(allowed=True, plan="FREE", used=1, limit=3, reset_at=None)


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
        # PgClient calls: vlogs SELECT, creator SELECT, UPDATE×2
        vlogs_pg = FakePgClient(rows=[{"id": "vlog-1"}, {"id": "vlog-2"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        clients = [vlogs_pg, creator_pg, update_pg, update_pg]
        idx = {"i": 0}
        def factory():
            c = clients[min(idx["i"], len(clients) - 1)]
            idx["i"] += 1
            return c

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=factory),
            patch("app.api.v1.webhooks.remaining_tripkit_slots", return_value=10),
            patch("app.api.v1.webhooks.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.status_code == 200
        assert resp.json()["queued"] == 2

    def test_returns_vlog_ids_in_response(self):
        vlogs_pg = FakePgClient(rows=[{"id": "vlog-A"}, {"id": "vlog-B"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        clients = [vlogs_pg, creator_pg, update_pg, update_pg]
        idx = {"i": 0}
        def factory():
            c = clients[min(idx["i"], len(clients) - 1)]
            idx["i"] += 1
            return c

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=factory),
            patch("app.api.v1.webhooks.remaining_tripkit_slots", return_value=10),
            patch("app.api.v1.webhooks.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        data = resp.json()
        assert "vlog_ids" in data
        assert set(data["vlog_ids"]) == {"vlog-A", "vlog-B"}

    def test_marks_vlogs_as_queued(self):
        vlogs_pg = FakePgClient(rows=[{"id": "vlog-X"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        clients = [vlogs_pg, creator_pg, update_pg]
        idx = {"i": 0}
        def factory():
            c = clients[min(idx["i"], len(clients) - 1)]
            idx["i"] += 1
            return c

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=factory),
            patch("app.api.v1.webhooks.remaining_tripkit_slots", return_value=10),
            patch("app.api.v1.webhooks.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            client.post("/api/v1/webhooks/scan/trigger")

        # update_pg should have had an UPDATE with QUEUED
        queries = [q[0] for q in update_pg.cursor.queries]
        assert any("QUEUED" in q for q in queries)

    def test_requires_authentication(self):
        from app.main import app
        # No dependency override — real auth will fail
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/api/v1/webhooks/scan/trigger")
        assert resp.status_code == 401

    def test_adds_background_task_per_vlog(self):
        vlogs_pg = FakePgClient(rows=[{"id": "vlog-1"}, {"id": "vlog-2"}, {"id": "vlog-3"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        clients = [vlogs_pg, creator_pg, update_pg, update_pg, update_pg]
        idx = {"i": 0}
        def factory():
            c = clients[min(idx["i"], len(clients) - 1)]
            idx["i"] += 1
            return c

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=factory),
            patch("app.api.v1.webhooks.remaining_tripkit_slots", return_value=10),
            patch("app.api.v1.webhooks.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.webhooks.process_vlog_task") as mock_task,
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.json()["queued"] == 3

    def test_single_vlog_queued(self):
        vlogs_pg = FakePgClient(rows=[{"id": "only-vlog"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        clients = [vlogs_pg, creator_pg, update_pg]
        idx = {"i": 0}
        def factory():
            c = clients[min(idx["i"], len(clients) - 1)]
            idx["i"] += 1
            return c

        with (
            patch("app.api.v1.webhooks.PgClient", side_effect=factory),
            patch("app.api.v1.webhooks.remaining_tripkit_slots", return_value=10),
            patch("app.api.v1.webhooks.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.webhooks.process_vlog_task"),
        ):
            client = _make_client()
            resp = client.post("/api/v1/webhooks/scan/trigger")

        assert resp.json()["queued"] == 1
        assert resp.json()["vlog_ids"] == ["only-vlog"]
