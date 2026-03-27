"""
test_hotel_booking_api.py
─────────────────────────────────────────────────────────────────────────────
Integration-style tests for:
  POST /api/v1/hotels/book
  POST /api/v1/hotels/prebook
  POST /api/v1/hotels/search

Schema-guard pattern
────────────────────
The PGRST204 "Could not find column" error is caught by asserting that every
INSERT payload contains *only* columns that exist in the `bookings` table.

KNOWN_BOOKING_INSERT_COLUMNS is the single source of truth. If you add a
new column to the DB, add it here too. If you add it here without a DB
migration, the test will pass but production will break — so treat a change
to this set as a mandatory two-step: migration first, constant second.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import UserClaims, get_current_user

# ─── Ground-truth column set for bookings INSERT ─────────────────────────────
# These are the columns the application writes on every hotel booking.
# Supabase auto-populates id + created_at — they must NOT appear here.
KNOWN_BOOKING_INSERT_COLUMNS = {
    "trip_id",
    "user_id",
    "booking_type",
    "provider",
    "duffel_order_id",
    "duffel_booking_reference",
    "status",
    "total_amount",
    "currency",
    "duffel_response",
    "search_params",
    "booked_at",
}

# ─── Shared fake data ─────────────────────────────────────────────────────────

FAKE_USER = UserClaims(user_id="user-abc", email="test@example.com")

FAKE_BOOKING_ROW = {
    "id": "booking-1",
    "trip_id": "trip-1",
    "user_id": "user-abc",
    "booking_type": "hotel",
    "provider": "liteapi",
    "duffel_order_id": "LA-ORDER-1",
    "duffel_booking_reference": "LA-ORDER-1",
    "status": "confirmed",
    "total_amount": 500.0,
    "currency": "USD",
    "duffel_response": {},
    "search_params": {},
    "booked_at": "2026-01-01T00:00:00+00:00",
    "created_at": "2026-01-01T00:00:00+00:00",
}

BOOK_BODY_LITEAPI = {
    "rate_id": "liteapi_hotel_offer123",
    "guests": [{"given_name": "Alice", "family_name": "Smith"}],
    "trip_id": "trip-1",
    "prebook_id": "prebook-abc",
    "hotel_name": "Grand Hotel",
    "check_in": "2026-06-01",
    "check_out": "2026-06-05",
    "hotel_address": "1 Main St",
    "hotel_rating": 4.5,
}

BOOK_BODY_DUFFEL = {**BOOK_BODY_LITEAPI, "rate_id": "duffel_rate_xyz"}
BOOK_BODY_BCOM = {**BOOK_BODY_LITEAPI, "rate_id": "booking_com_12345_67890", "prebook_id": "preview-tok"}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_db(trip_exists: bool = True, booking_row: dict | None = None):
    """Build a Supabase mock that routes .table() calls by table name."""
    db = MagicMock()

    # trips table
    trips = MagicMock()
    trips_exec = MagicMock(data=[{"id": "trip-1"}] if trip_exists else [])
    for m in ("select", "eq", "update", "execute"):
        getattr(trips, m).return_value = trips
    trips.execute.return_value = trips_exec

    # bookings table
    bookings = MagicMock()
    row = booking_row if booking_row is not None else FAKE_BOOKING_ROW
    bookings_exec = MagicMock(data=[row])
    for m in ("select", "insert", "update", "eq", "execute"):
        getattr(bookings, m).return_value = bookings
    bookings.execute.return_value = bookings_exec

    db.table.side_effect = lambda name: trips if name == "trips" else bookings
    return db, trips, bookings


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def override_auth():
    """Bypass JWT verification for every test in this module."""
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


# ═══════════════════════════════════════════════════════════════════════════════
# Schema-guard: INSERT payload column validation
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookingInsertSchema:
    """Assert the bookings INSERT payload exactly matches the DB schema.

    These tests would have caught the PGRST204 'metadata column not found'
    regression before it reached production.
    """

    def _captured_insert_payload(self, client, body: dict) -> dict:
        """POST /hotels/book with a fresh DB mock and return what .insert() received."""
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={
                       "id": "LA-1", "reference": "LA-1",
                       "total_amount": "500.0", "currency": "USD",
                       "provider": "liteapi", "raw": {},
                   }), \
             patch("app.api.v1.hotels.duffel_service.create_hotel_order",
                   return_value={
                       "id": "DU-1", "total_amount": "500", "currency": "USD",
                   }), \
             patch("app.api.v1.hotels.booking_com_service.create_order",
                   new=AsyncMock(return_value={
                       "order_id": "BC-1", "total_amount": 500, "currency": "USD",
                   })):
            r = client.post("/api/v1/hotels/book", json=body)

        assert r.status_code == 200, f"Expected 200 but got {r.status_code}: {r.text}"
        bookings.insert.assert_called_once()
        return bookings.insert.call_args[0][0]

    def test_liteapi_insert_has_no_unknown_columns(self, client):
        payload = self._captured_insert_payload(client, BOOK_BODY_LITEAPI)
        unexpected = set(payload.keys()) - KNOWN_BOOKING_INSERT_COLUMNS
        assert unexpected == set(), (
            f"INSERT contains column(s) that don't exist in the DB: {unexpected}. "
            "Either add a migration or remove the column from the payload."
        )

    def test_liteapi_insert_has_all_required_columns(self, client):
        payload = self._captured_insert_payload(client, BOOK_BODY_LITEAPI)
        missing = KNOWN_BOOKING_INSERT_COLUMNS - set(payload.keys())
        assert missing == set(), f"INSERT is missing expected columns: {missing}"

    def test_duffel_insert_has_no_unknown_columns(self, client):
        payload = self._captured_insert_payload(client, BOOK_BODY_DUFFEL)
        unexpected = set(payload.keys()) - KNOWN_BOOKING_INSERT_COLUMNS
        assert unexpected == set(), f"Duffel INSERT contains unknown columns: {unexpected}"

    def test_booking_com_insert_has_no_unknown_columns(self, client):
        payload = self._captured_insert_payload(client, BOOK_BODY_BCOM)
        unexpected = set(payload.keys()) - KNOWN_BOOKING_INSERT_COLUMNS
        assert unexpected == set(), f"Booking.com INSERT contains unknown columns: {unexpected}"

    def test_insert_payload_never_contains_metadata(self, client):
        """Regression: PGRST204 caused by 'metadata' column not existing in DB."""
        for body in (BOOK_BODY_LITEAPI, BOOK_BODY_DUFFEL, BOOK_BODY_BCOM):
            payload = self._captured_insert_payload(client, body)
            assert "metadata" not in payload, (
                "'metadata' column is not in the bookings table. "
                "This would cause PGRST204 in production."
            )


# ═══════════════════════════════════════════════════════════════════════════════
# Book endpoint: provider routing + field values
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookHotelProviderRouting:

    def test_liteapi_booking_sets_correct_provider(self, client):
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={"id": "LA-1", "reference": "LA-1",
                                 "total_amount": "300.0", "currency": "EUR",
                                 "provider": "liteapi", "raw": {}}):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)

        assert r.status_code == 200
        payload = bookings.insert.call_args[0][0]
        assert payload["provider"] == "liteapi"
        assert payload["booking_type"] == "hotel"
        assert payload["status"] == "confirmed"
        assert payload["user_id"] == "user-abc"
        assert payload["trip_id"] == "trip-1"

    def test_liteapi_booking_stores_order_id(self, client):
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={"id": "LA-ORDER-99", "reference": "LA-ORDER-99",
                                 "total_amount": "200.0", "currency": "USD",
                                 "provider": "liteapi", "raw": {}}):
            client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)

        payload = bookings.insert.call_args[0][0]
        assert payload["duffel_order_id"] == "LA-ORDER-99"
        assert payload["duffel_booking_reference"] == "LA-ORDER-99"

    def test_booking_com_sets_correct_provider(self, client):
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.booking_com_service.create_order",
                   new=AsyncMock(return_value={
                       "order_id": "BC-ORD-55", "total_amount": 750, "currency": "GBP"
                   })):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_BCOM)

        assert r.status_code == 200
        payload = bookings.insert.call_args[0][0]
        assert payload["provider"] == "booking_com"
        assert payload["duffel_order_id"] == "BC-ORD-55"

    def test_duffel_booking_sets_correct_provider(self, client):
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.duffel_service.create_hotel_order",
                   return_value={"id": "DU-ORD-7", "total_amount": "400",
                                 "currency": "USD"}):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_DUFFEL)

        assert r.status_code == 200
        payload = bookings.insert.call_args[0][0]
        assert payload["provider"] == "duffel"
        assert payload["duffel_order_id"] == "DU-ORD-7"

    def test_search_params_stored_correctly(self, client):
        db, _, bookings = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={"id": "X", "reference": "X", "total_amount": "100",
                                 "currency": "USD", "provider": "liteapi", "raw": {}}):
            client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)

        payload = bookings.insert.call_args[0][0]
        sp = payload["search_params"]
        assert sp["hotel_name"] == "Grand Hotel"
        assert sp["check_in"] == "2026-06-01"
        assert sp["check_out"] == "2026-06-05"
        assert sp["hotel_rating"] == 4.5

    def test_trip_status_updated_to_booked(self, client):
        db, trips, _ = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={"id": "X", "reference": "X", "total_amount": "100",
                                 "currency": "USD", "provider": "liteapi", "raw": {}}):
            client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)

        trips.update.assert_called_once_with({"status": "booked"})


# ═══════════════════════════════════════════════════════════════════════════════
# Book endpoint: error handling
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookHotelErrors:

    def test_returns_404_when_trip_not_found(self, client):
        db, _, _ = _make_db(trip_exists=False)
        with patch("app.api.v1.hotels.get_supabase", return_value=db):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)
        assert r.status_code == 404

    def test_returns_409_on_stale_liteapi_offer(self, client):
        from app.core.exceptions import StaleOfferError
        db, _, _ = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   side_effect=StaleOfferError("Offer expired")):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)
        assert r.status_code == 409

    def test_returns_502_when_liteapi_raises(self, client):
        db, _, _ = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   side_effect=RuntimeError("LiteAPI down")):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)
        assert r.status_code == 502

    def test_returns_502_when_booking_com_returns_none(self, client):
        db, _, _ = _make_db()
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.booking_com_service.create_order",
                   new=AsyncMock(return_value=None)):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_BCOM)
        assert r.status_code == 502

    def test_returns_500_when_db_insert_returns_empty(self, client):
        db, _, bookings = _make_db()
        bookings.execute.return_value = MagicMock(data=[])  # empty = save failed
        with patch("app.api.v1.hotels.get_supabase", return_value=db), \
             patch("app.api.v1.hotels.liteapi_service.create_hotel_order",
                   return_value={"id": "X", "reference": "X", "total_amount": "100",
                                 "currency": "USD", "provider": "liteapi", "raw": {}}):
            r = client.post("/api/v1/hotels/book", json=BOOK_BODY_LITEAPI)
        assert r.status_code == 500

    def test_booking_com_requires_prebook_id(self, client):
        db, _, _ = _make_db()
        body = {**BOOK_BODY_BCOM, "prebook_id": None}
        with patch("app.api.v1.hotels.get_supabase", return_value=db):
            r = client.post("/api/v1/hotels/book", json=body)
        assert r.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# Prebook endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestPrebookHotel:

    def test_liteapi_prebook_returns_prebook_id(self, client):
        with patch("app.api.v1.hotels.liteapi_service.prebook_hotel",
                   return_value="pb-token-99"):
            r = client.post("/api/v1/hotels/prebook",
                            json={"rate_id": "liteapi_hotel_abc"})
        assert r.status_code == 200
        assert r.json()["prebook_id"] == "pb-token-99"

    def test_liteapi_prebook_409_on_stale_offer(self, client):
        from app.core.exceptions import StaleOfferError
        with patch("app.api.v1.hotels.liteapi_service.prebook_hotel",
                   side_effect=StaleOfferError("expired")):
            r = client.post("/api/v1/hotels/prebook",
                            json={"rate_id": "liteapi_hotel_abc"})
        assert r.status_code == 409

    def test_booking_com_prebook_returns_token(self, client):
        with patch("app.api.v1.hotels.booking_com_service.preview_order",
                   new=AsyncMock(return_value={"token": "bcom-preview-tok"})):
            r = client.post("/api/v1/hotels/prebook",
                            json={"rate_id": "booking_com_hotel_12345_67890"})
        assert r.status_code == 200
        assert r.json()["prebook_id"] == "bcom-preview-tok"

    def test_booking_com_prebook_502_when_preview_fails(self, client):
        with patch("app.api.v1.hotels.booking_com_service.preview_order",
                   new=AsyncMock(return_value=None)):
            r = client.post("/api/v1/hotels/prebook",
                            json={"rate_id": "booking_com_hotel_12345_67890"})
        assert r.status_code == 502

    def test_unknown_provider_returns_400(self, client):
        r = client.post("/api/v1/hotels/prebook",
                        json={"rate_id": "unknown_provider_abc"})
        assert r.status_code == 400
