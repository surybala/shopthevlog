"""
test_bookings_api.py
─────────────────────────────────────────────────────────────────────────────
Tests for GET/DELETE /api/v1/bookings (list, retrieve, cancel).

Covers:
  - list_bookings: returns user's bookings, filters by trip_id
  - get_booking: 200 happy path, 404 when not found
  - cancel_booking: correct downstream service called per provider,
    order_id sourced from duffel_order_id (not a metadata column),
    non-refundable refusal → 422, network error → 502, 404 guard
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import UserClaims, get_current_user

# ─── Fake data ────────────────────────────────────────────────────────────────

FAKE_USER = UserClaims(user_id="user-abc", email="test@example.com")


def _booking(
    booking_id: str = "booking-1",
    booking_type: str = "hotel",
    provider: str = "liteapi",
    order_id: str = "ORDER-1",
    status: str = "confirmed",
) -> dict:
    return {
        "id": booking_id,
        "trip_id": "trip-1",
        "user_id": "user-abc",
        "booking_type": booking_type,
        "provider": provider,
        "duffel_order_id": order_id,
        "duffel_booking_reference": order_id,
        "status": status,
        "total_amount": 400.0,
        "currency": "USD",
        "duffel_response": {},
        "search_params": {},
        "booked_at": "2026-01-01T00:00:00+00:00",
        "created_at": "2026-01-01T00:00:00+00:00",
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_db(rows: list[dict] | None = None, single_row: dict | None = None):
    """Mock Supabase client for bookings queries."""
    db = MagicMock()
    table = MagicMock()

    list_exec = MagicMock(data=rows or [])
    single_exec = MagicMock(data=single_row)

    # Chain all query methods back to the table mock so we can fluently call
    # .select().eq().order() etc. and then .execute()
    for m in ("select", "eq", "neq", "order", "limit", "single",
              "update", "insert", "delete", "filter"):
        getattr(table, m).return_value = table

    # Default execute returns list_exec; override via single_exec fixture
    table.execute.return_value = list_exec
    db.table.return_value = table
    return db, table, list_exec, single_exec


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
# GET /api/v1/bookings
# ═══════════════════════════════════════════════════════════════════════════════

class TestListBookings:

    def test_returns_all_user_bookings(self, client):
        rows = [_booking("b1"), _booking("b2")]
        db, _, _, _ = _make_db(rows=rows)
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = client.get("/api/v1/bookings")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_returns_empty_list_when_no_bookings(self, client):
        db, _, _, _ = _make_db(rows=[])
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = client.get("/api/v1/bookings")
        assert r.status_code == 200
        assert r.json() == []

    def test_filters_by_trip_id(self, client):
        rows = [_booking("b1")]
        db, table, _, _ = _make_db(rows=rows)
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = client.get("/api/v1/bookings?trip_id=trip-1")
        assert r.status_code == 200
        # Confirm eq("trip_id", ...) was called
        eq_calls = [str(c) for c in table.eq.call_args_list]
        assert any("trip-1" in s for s in eq_calls)


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/v1/bookings/{id}
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetBooking:

    def test_returns_booking_when_found(self, client):
        row = _booking()
        db, table, _, single_exec = _make_db(single_row=row)
        table.execute.return_value = single_exec
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = client.get("/api/v1/bookings/booking-1")
        assert r.status_code == 200
        assert r.json()["id"] == "booking-1"

    def test_returns_404_when_not_found(self, client):
        db, table, _, single_exec = _make_db(single_row=None)
        single_exec.data = None
        table.execute.return_value = single_exec
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = client.get("/api/v1/bookings/nonexistent")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# DELETE /api/v1/bookings/{id} — cancel routing
# ═══════════════════════════════════════════════════════════════════════════════

class TestCancelBooking:

    def _cancel(self, client, db, booking_id: str = "booking-1"):
        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            return client.delete(f"/api/v1/bookings/{booking_id}")

    # ── 404 guard ─────────────────────────────────────────────────────────────

    def test_returns_404_when_booking_not_found(self, client):
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=None)
        r = self._cancel(client, db)
        assert r.status_code == 404

    # ── LiteAPI hotel ─────────────────────────────────────────────────────────

    def test_cancels_liteapi_hotel(self, client):
        row = _booking(provider="liteapi", booking_type="hotel", order_id="LA-ORD-1")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.liteapi_service.cancel_hotel_booking") as mock_cancel:
            r = self._cancel(client, db)

        assert r.status_code == 200
        mock_cancel.assert_called_once_with("LA-ORD-1")

    # ── Duffel hotel ──────────────────────────────────────────────────────────

    def test_cancels_duffel_hotel(self, client):
        row = _booking(provider="duffel", booking_type="hotel", order_id="DU-ORD-1")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.duffel_service.cancel_hotel_order") as mock_cancel:
            r = self._cancel(client, db)

        assert r.status_code == 200
        mock_cancel.assert_called_once_with("DU-ORD-1")

    # ── Duffel flight ─────────────────────────────────────────────────────────

    def test_cancels_duffel_flight(self, client):
        row = _booking(provider="duffel", booking_type="flight", order_id="DU-FLT-1")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.duffel_service.cancel_flight_order") as mock_cancel:
            r = self._cancel(client, db)

        assert r.status_code == 200
        mock_cancel.assert_called_once_with("DU-FLT-1")

    # ── Booking.com ───────────────────────────────────────────────────────────

    def test_cancels_booking_com_using_order_id_field(self, client):
        """
        Regression: cancel used to read from metadata.booking_com_order_id.
        That column doesn't exist. Now it reads duffel_order_id directly.
        """
        row = _booking(provider="booking_com", booking_type="hotel", order_id="BC-ORD-1")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.booking_com_service.cancel_order",
                   new=AsyncMock(return_value=True)) as mock_cancel:
            r = self._cancel(client, db)

        assert r.status_code == 200
        # Must be called with the value from duffel_order_id, NOT from any
        # metadata column (which would KeyError / return None).
        mock_cancel.assert_awaited_once_with("BC-ORD-1")

    def test_booking_com_cancel_422_when_non_refundable(self, client):
        row = _booking(provider="booking_com", booking_type="hotel", order_id="BC-ORD-2")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.booking_com_service.cancel_order",
                   new=AsyncMock(return_value=False)):
            r = self._cancel(client, db)

        assert r.status_code == 422
        assert "non-refundable" in r.json()["detail"].lower() or "cancel" in r.json()["detail"].lower()

    # ── Error propagation ─────────────────────────────────────────────────────

    def test_downstream_network_error_returns_502(self, client):
        row = _booking(provider="liteapi", booking_type="hotel", order_id="LA-ORD-ERR")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.liteapi_service.cancel_hotel_booking",
                   side_effect=ConnectionError("timeout")):
            r = self._cancel(client, db)

        assert r.status_code == 502

    def test_db_status_updated_to_cancelled_on_success(self, client):
        row = _booking(provider="liteapi", booking_type="hotel", order_id="LA-ORD-3")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db), \
             patch("app.api.v1.bookings.liteapi_service.cancel_hotel_booking"):
            r = self._cancel(client, db, "booking-1")

        assert r.status_code == 200
        # The update({"status": "cancelled"}) call must have happened
        table.update.assert_called_with({"status": "cancelled"})

    def test_unknown_provider_does_db_only_cancel(self, client):
        """Bookings with no downstream handler still get DB-cancelled."""
        row = _booking(provider="manual", booking_type="hotel", order_id="MANUAL-1")
        db, table, _, _ = _make_db()
        table.execute.return_value = MagicMock(data=row)

        with patch("app.api.v1.bookings.get_supabase", return_value=db):
            r = self._cancel(client, db)

        assert r.status_code == 200
        table.update.assert_called_with({"status": "cancelled"})
