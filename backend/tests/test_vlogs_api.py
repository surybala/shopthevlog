"""
Tests for app.api.v1.vlogs — list, process-trigger, and status endpoints.

All external calls (PostgreSQL, background tasks) are fully mocked.
Auth is bypassed by overriding the get_current_user FastAPI dependency.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from tests.conftest import FakePgClient
from app.core.security import UserClaims
from app.services.quota_service import QuotaResult


def _allowed_quota() -> QuotaResult:
    return QuotaResult(allowed=True, plan="FREE", used=1, limit=3, reset_at=None)


# ─── App + auth override helpers ─────────────────────────────────────────────

def _make_client(pg: FakePgClient, user_id: str = "user-001") -> TestClient:
    """
    Create a TestClient with:
      - PgClient patched to the given FakePgClient
      - get_current_user overridden to return a fixed UserClaims
    """
    from app.main import app
    from app.core.security import get_current_user

    fake_user = UserClaims(user_id=user_id, email="test@example.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user

    client = TestClient(app, raise_server_exceptions=False)
    return client


def _restore_overrides():
    from app.main import app
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/vlogs  — list vlogs
# ─────────────────────────────────────────────────────────────────────────────

class TestListVlogs:

    def teardown_method(self, _method):
        _restore_overrides()

    def test_returns_empty_list_when_no_vlogs(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs")

        assert resp.status_code == 200
        assert resp.json() == {"vlogs": []}

    def test_returns_vlog_list(self):
        rows = [
            {
                "id": "vlog-001",
                "title": "Tokyo Adventure",
                "description": "5 days in Tokyo",
                "thumbnailUrl": "https://img.example.com/thumb.jpg",
                "externalUrl": "https://youtube.com/watch?v=abc",
                "publishedAt": "2024-01-01T00:00:00",
                "processingStatus": "COMPLETE",
                "processedAt": "2024-01-02T10:00:00",
                "platform": "YOUTUBE",
                "tripKitId": "kit-001",
                "tripKitTitle": "Tokyo in 5 Days",
                "tripKitPublished": True,
            }
        ]
        pg = FakePgClient(rows=rows)
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["vlogs"]) == 1
        assert data["vlogs"][0]["id"] == "vlog-001"
        assert data["vlogs"][0]["processingStatus"] == "COMPLETE"
        assert data["vlogs"][0]["tripKitId"] == "kit-001"

    def test_vlog_without_trip_kit_has_null_kit_fields(self):
        rows = [
            {
                "id": "vlog-002",
                "title": "Paris Trip",
                "description": None,
                "thumbnailUrl": None,
                "externalUrl": "https://youtube.com/watch?v=xyz",
                "publishedAt": None,
                "processingStatus": "PENDING",
                "processedAt": None,
                "platform": "YOUTUBE",
                "tripKitId": None,
                "tripKitTitle": None,
                "tripKitPublished": None,
            }
        ]
        pg = FakePgClient(rows=rows)
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs")

        assert resp.status_code == 200
        vlog = resp.json()["vlogs"][0]
        assert vlog["tripKitId"] is None
        assert vlog["tripKitTitle"] is None

    def test_requires_authentication(self):
        from app.main import app
        from app.core.security import get_current_user
        # Ensure override is cleared so real auth runs
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/vlogs")
        assert resp.status_code == 401

    def test_query_passes_user_id_to_db(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg, user_id="user-xyz")
            client.get("/api/v1/vlogs")

        # The query should have been executed with the user_id
        assert len(pg.cursor.queries) == 1
        _sql, params = pg.cursor.queries[0]
        assert params == ("user-xyz",)


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/vlogs/{vlog_id}/process  — trigger processing
# ─────────────────────────────────────────────────────────────────────────────

class TestTriggerProcess:

    def teardown_method(self, _method):
        _restore_overrides()

    def test_returns_404_when_vlog_not_found(self):
        pg = FakePgClient(rows=[])   # fetchone → None
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.post("/api/v1/vlogs/no-such-vlog/process")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_already_transcribing_returns_early(self):
        pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "TRANSCRIBING", "hasOpportunities": False}])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "TRANSCRIBING"
        assert "already" in data["message"].lower()

    def test_already_extracting_returns_early(self):
        pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "EXTRACTING", "hasOpportunities": False}])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "EXTRACTING"

    def test_existing_opportunities_return_already_processed(self):
        pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "FAILED", "hasOpportunities": True}])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "REVIEW_PENDING"
        assert "already processed" in data["message"].lower()

    def test_pending_vlog_queued_and_task_added(self):
        # PgClient calls: vlog SELECT, creator SELECT, vlog UPDATE
        select_pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "PENDING", "hasOpportunities": False}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        with (
            patch("app.api.v1.vlogs.PgClient", side_effect=[select_pg, creator_pg, update_pg]),
            patch("app.api.v1.vlogs.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.vlogs.enqueue") as mock_task,
        ):
            client = _make_client(select_pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "QUEUED"
        assert data["vlog_id"] == "vlog-001"

    def test_failed_vlog_can_be_requeued(self):
        select_pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "FAILED", "hasOpportunities": False}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        with (
            patch("app.api.v1.vlogs.PgClient", side_effect=[select_pg, creator_pg, update_pg]),
            patch("app.api.v1.vlogs.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.vlogs.enqueue"),
        ):
            client = _make_client(select_pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_complete_vlog_can_be_reprocessed(self):
        """COMPLETE vlogs are allowed to be re-triggered (re-generation)."""
        select_pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "COMPLETE", "hasOpportunities": False}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        with (
            patch("app.api.v1.vlogs.PgClient", side_effect=[select_pg, creator_pg, update_pg]),
            patch("app.api.v1.vlogs.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.vlogs.enqueue"),
        ):
            client = _make_client(select_pg)
            resp = client.post("/api/v1/vlogs/vlog-001/process")

        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_ownership_enforced_by_user_id(self):
        """The SELECT joins on creator.userId — a vlog owned by another user returns 404."""
        # fetchone returns None → different creator's vlog, or vlog doesn't exist
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg, user_id="wrong-user")
            resp = client.post("/api/v1/vlogs/vlog-owned-by-other/process")

        assert resp.status_code == 404

    def test_update_query_sets_queued_status(self):
        select_pg = FakePgClient(rows=[{"id": "vlog-001", "processingStatus": "PENDING"}])
        creator_pg = FakePgClient(rows=[{"id": "creator-1"}])
        update_pg = FakePgClient(rows=[])

        with (
            patch("app.api.v1.vlogs.PgClient", side_effect=[select_pg, creator_pg, update_pg]),
            patch("app.api.v1.vlogs.check_and_consume_tripkit", return_value=_allowed_quota()),
            patch("app.api.v1.vlogs.enqueue"),
        ):
            client = _make_client(select_pg)
            client.post("/api/v1/vlogs/vlog-001/process")

        # The UPDATE query should reference QUEUED and vlog-001
        sql, params = update_pg.cursor.queries[0]
        assert "QUEUED" in sql
        assert params == ("vlog-001",)

    def test_requires_authentication(self):
        from app.main import app
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/api/v1/vlogs/vlog-001/process")
        assert resp.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/vlogs/{vlog_id}/status  — polling status
# ─────────────────────────────────────────────────────────────────────────────

class TestGetVlogStatus:

    def teardown_method(self, _method):
        _restore_overrides()

    def test_returns_404_when_not_found(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs/no-such-vlog/status")

        assert resp.status_code == 404

    def test_returns_status_for_in_progress_vlog(self):
        row = {
            "id": "vlog-001",
            "processingStatus": "TRANSCRIBING",
            "processedAt": None,
            "tripKitId": None,
            "tripKitTitle": None,
            "tripKitPublished": None,
        }
        pg = FakePgClient(rows=[row])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs/vlog-001/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["processingStatus"] == "TRANSCRIBING"
        assert data["tripKitId"] is None

    def test_returns_trip_kit_info_when_complete(self):
        row = {
            "id": "vlog-001",
            "processingStatus": "COMPLETE",
            "processedAt": "2024-06-01T12:00:00",
            "tripKitId": "kit-abc",
            "tripKitTitle": "5 Days in Tokyo",
            "tripKitPublished": False,
        }
        pg = FakePgClient(rows=[row])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg)
            resp = client.get("/api/v1/vlogs/vlog-001/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["processingStatus"] == "COMPLETE"
        assert data["tripKitId"] == "kit-abc"
        assert data["tripKitTitle"] == "5 Days in Tokyo"

    def test_ownership_enforced_by_user_id(self):
        pg = FakePgClient(rows=[])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg, user_id="wrong-user")
            resp = client.get("/api/v1/vlogs/vlog-owned-by-other/status")

        assert resp.status_code == 404

    def test_query_passes_correct_params(self):
        row = {
            "id": "vlog-001",
            "processingStatus": "PENDING",
            "processedAt": None,
            "tripKitId": None,
            "tripKitTitle": None,
            "tripKitPublished": None,
        }
        pg = FakePgClient(rows=[row])
        with patch("app.api.v1.vlogs.PgClient", return_value=pg):
            client = _make_client(pg, user_id="user-abc")
            client.get("/api/v1/vlogs/vlog-xyz/status")

        sql, params = pg.cursor.queries[0]
        assert params == ("vlog-xyz", "user-abc")

    def test_requires_authentication(self):
        from app.main import app
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/vlogs/vlog-001/status")
        assert resp.status_code == 401
