"""
API-level tests for POST /api/v1/cars/search and GET /api/v1/cars/detail/{id}.

The Booking.com service is mocked so no real HTTP calls are made.
Auth is bypassed via FastAPI's dependency_overrides mechanism.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_current_user

# ─── Fixtures ─────────────────────────────────────────────────────────────────

CAR_OFFER = {
    "id": "booking_com_car_001",
    "provider": "booking_com",
    "car_category": "Economy",
    "car_model": "Toyota Yaris",
    "supplier": "Hertz",
    "pickup_location": "Tokyo Airport",
    "dropoff_location": "Tokyo Airport",
    "pickup_datetime": "2024-06-01T10:00:00",
    "dropoff_datetime": "2024-06-05T10:00:00",
    "total_amount": "180.00",
    "currency": "USD",
    "passengers": 4,
    "bags": 2,
    "photos": [],
    "features": ["AC", "Automatic"],
    "cancellation_type": "free_cancellation",
    "metadata": {},
}

VALID_SEARCH_BODY = {
    "pickup_location": "Tokyo Airport",
    "pickup_datetime": "2024-06-01T10:00:00",
    "dropoff_datetime": "2024-06-05T10:00:00",
}


def _fake_user():
    user = MagicMock()
    user.user_id = "user-test-123"
    return user


def _client_with_auth() -> TestClient:
    """Return a TestClient with auth dependency overridden."""
    app.dependency_overrides[get_current_user] = lambda: _fake_user()
    return TestClient(app, raise_server_exceptions=False)


def _reset_overrides():
    app.dependency_overrides.clear()


# ─── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search_cars_returns_200_with_results():
    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.cars.booking_com_service.search_cars",
            new_callable=AsyncMock,
            return_value=[CAR_OFFER],
        ):
            resp = client.post("/api/v1/cars/search", json=VALID_SEARCH_BODY)
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["provider"] == "booking_com"
    assert data[0]["car_category"] == "Economy"


@pytest.mark.asyncio
async def test_search_cars_returns_empty_list_when_provider_unavailable():
    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.cars.booking_com_service.search_cars",
            new_callable=AsyncMock,
            return_value=[],
        ):
            resp = client.post("/api/v1/cars/search", json=VALID_SEARCH_BODY)
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_search_cars_missing_required_field_returns_422():
    client = _client_with_auth()
    try:
        # Missing pickup_datetime and dropoff_datetime
        resp = client.post(
            "/api/v1/cars/search",
            json={"pickup_location": "Tokyo"},
        )
    finally:
        _reset_overrides()

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_cars_results_sorted_by_price_ascending():
    expensive = {**CAR_OFFER, "id": "car_expensive", "total_amount": "500.00"}
    cheap = {**CAR_OFFER, "id": "car_cheap", "total_amount": "100.00"}

    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.cars.booking_com_service.search_cars",
            new_callable=AsyncMock,
            return_value=[expensive, cheap],
        ):
            resp = client.post("/api/v1/cars/search", json=VALID_SEARCH_BODY)
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    results = resp.json()
    assert results[0]["id"] == "car_cheap"
    assert results[1]["id"] == "car_expensive"


@pytest.mark.asyncio
async def test_car_detail_returns_501():
    client = _client_with_auth()
    try:
        resp = client.get("/api/v1/cars/detail/some-car-id")
    finally:
        _reset_overrides()

    assert resp.status_code == 501
