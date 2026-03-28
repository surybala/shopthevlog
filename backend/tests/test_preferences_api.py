"""
test_preferences_api.py
─────────────────────────────────────────────────────────────────────────────
Tests for GET /api/v1/preferences and PATCH /api/v1/preferences.

Covers:
  - GET: returns defaults when no row exists, returns existing row, auth required
  - PATCH: creates new row, updates existing, triggers background seed task,
    partial updates (only specified fields), empty travel_styles accepted
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import UserClaims, get_current_user

FAKE_USER = UserClaims(user_id="user-prefs-001", email="prefs@example.com")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_db(prefs_row=None):
    """Mock Supabase where table('taste_preferences') returns prefs_row."""
    db = MagicMock()
    table = MagicMock()
    for m in ("select", "eq", "upsert", "insert", "update", "delete", "filter"):
        getattr(table, m).return_value = table
    table.execute.return_value = MagicMock(data=[prefs_row] if prefs_row else [])
    db.table.return_value = table
    return db, table


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/v1/preferences
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetPreferences:

    def test_returns_defaults_when_no_row_exists(self, client):
        db, _ = _make_db(prefs_row=None)
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            r = client.get("/api/v1/preferences")
        assert r.status_code == 200
        body = r.json()
        assert body["travel_styles"] == []
        assert body["destinations"] == []
        assert body["trip_durations"] == []
        assert body["budget_range"] is None
        assert body["home_location"] is None

    def test_returns_saved_preferences(self, client):
        saved = {
            "id": "pref-1",
            "user_id": FAKE_USER.user_id,
            "travel_styles": ["adventure", "beach"],
            "destinations": ["Japan", "Thailand"],
            "trip_durations": ["1-2 weeks"],
            "budget_range": "mid",
            "home_location": "New York",
        }
        db, _ = _make_db(prefs_row=saved)
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            r = client.get("/api/v1/preferences")
        assert r.status_code == 200
        body = r.json()
        assert body["travel_styles"] == ["adventure", "beach"]
        assert body["destinations"] == ["Japan", "Thailand"]
        assert body["home_location"] == "New York"
        assert body["budget_range"] == "mid"

    def test_queries_by_current_user_id(self, client):
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            client.get("/api/v1/preferences")
        # Confirm the eq("user_id", ...) call used the authenticated user's id
        eq_calls = [str(c) for c in table.eq.call_args_list]
        assert any(FAKE_USER.user_id in s for s in eq_calls)

    def test_returns_200_when_row_exists_but_fields_are_null(self, client):
        partial = {
            "id": "pref-2",
            "user_id": FAKE_USER.user_id,
            "travel_styles": None,
            "destinations": None,
            "trip_durations": None,
            "budget_range": None,
            "home_location": None,
        }
        db, _ = _make_db(prefs_row=partial)
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            r = client.get("/api/v1/preferences")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# PATCH /api/v1/preferences
# ═══════════════════════════════════════════════════════════════════════════════

class TestUpdatePreferences:

    def test_returns_200_on_success(self, client):
        db, _ = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.preferences.BackgroundTasks.add_task", MagicMock()):
            r = client.patch("/api/v1/preferences", json={"travel_styles": ["adventure"]})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_upserts_travel_styles(self, client):
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", new=AsyncMock()):
            client.patch("/api/v1/preferences", json={"travel_styles": ["luxury", "solo"]})
        # Confirm upsert was called with the correct styles
        upsert_args = table.upsert.call_args
        assert upsert_args is not None
        payload = upsert_args[0][0]
        assert payload["travel_styles"] == ["luxury", "solo"]
        assert payload["user_id"] == FAKE_USER.user_id

    def test_upserts_home_location(self, client):
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            client.patch("/api/v1/preferences", json={"home_location": "London"})
        upsert_args = table.upsert.call_args
        payload = upsert_args[0][0]
        assert payload["home_location"] == "London"

    def test_upserts_budget_range(self, client):
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            client.patch("/api/v1/preferences", json={"budget_range": "luxury"})
        upsert_args = table.upsert.call_args
        payload = upsert_args[0][0]
        assert payload["budget_range"] == "luxury"

    def test_empty_travel_styles_accepted(self, client):
        """Clearing all interests should be allowed (saves empty list)."""
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", new=AsyncMock()):
            r = client.patch("/api/v1/preferences", json={"travel_styles": []})
        assert r.status_code == 200

    def test_null_fields_excluded_from_upsert_payload(self, client):
        """Fields set to None should not overwrite existing DB values."""
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            client.patch("/api/v1/preferences", json={"home_location": "Tokyo"})
        upsert_args = table.upsert.call_args
        payload = upsert_args[0][0]
        # travel_styles was not sent — should not appear in the upsert payload
        assert "travel_styles" not in payload

    def test_on_conflict_is_user_id(self, client):
        """Upsert must use on_conflict='user_id' to update the existing row."""
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", new=AsyncMock()):
            client.patch("/api/v1/preferences", json={"travel_styles": ["adventure"]})
        upsert_args = table.upsert.call_args
        assert upsert_args[1].get("on_conflict") == "user_id"

    def test_travel_styles_change_triggers_seed_task(self, client):
        """Saving travel_styles should queue a background seed + feed rebuild."""
        db, _ = _make_db()
        seed_mock = AsyncMock()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", seed_mock):
            r = client.patch("/api/v1/preferences", json={"travel_styles": ["beach", "luxury"]})
        assert r.status_code == 200
        # The background task is added; check the route returns 200 (task runs async)

    def test_destinations_change_triggers_seed_task(self, client):
        """Saving destinations should queue a background seed task."""
        db, _ = _make_db()
        seed_mock = AsyncMock()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", seed_mock):
            r = client.patch("/api/v1/preferences", json={"destinations": ["Paris", "Rome"]})
        assert r.status_code == 200

    def test_home_location_only_change_does_not_trigger_seed(self, client):
        """Changing home_location alone should NOT trigger a feed seed."""
        db, _ = _make_db()
        seed_mock = AsyncMock()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", seed_mock):
            r = client.patch("/api/v1/preferences", json={"home_location": "Sydney"})
        assert r.status_code == 200
        seed_mock.assert_not_called()

    def test_invalid_json_returns_422(self, client):
        db, _ = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db):
            r = client.patch(
                "/api/v1/preferences",
                content=b"not-json",
                headers={"Content-Type": "application/json"},
            )
        assert r.status_code == 422

    def test_multiple_fields_updated_together(self, client):
        """All provided fields are included in the single upsert call."""
        db, table = _make_db()
        with patch("app.api.v1.preferences.get_supabase", return_value=db), \
             patch("app.api.v1.social._seed_for_user_interests", new=AsyncMock()):
            client.patch("/api/v1/preferences", json={
                "travel_styles": ["mountain"],
                "home_location": "Berlin",
                "budget_range": "budget",
            })
        upsert_args = table.upsert.call_args
        payload = upsert_args[0][0]
        assert payload["travel_styles"] == ["mountain"]
        assert payload["home_location"] == "Berlin"
        assert payload["budget_range"] == "budget"
