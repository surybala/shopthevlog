"""
API-level tests for:
  POST /api/v1/experiences/search
  GET  /api/v1/experiences/detail/{attraction_id}

The Booking.com service is mocked so no real HTTP calls are made.
Auth is bypassed via FastAPI's dependency_overrides mechanism.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_current_user

# ─── Fixtures ─────────────────────────────────────────────────────────────────

EXPERIENCE_OFFER = {
    "id": "booking_com_exp_attr_001",
    "provider": "booking_com",
    "name": "Senso-ji Temple Tour",
    "description": "Historic temple in Asakusa.",
    "category": "Cultural",
    "location": "Tokyo",
    "lat": 35.7148,
    "lng": 139.7967,
    "photos": [{"url": "https://example.com/temple.jpg"}],
    "review_score": 4.8,
    "review_count": 500,
    "min_price": "25.00",
    "currency": "USD",
    "duration_minutes": 120,
    "metadata": {"raw_id": "attr_001"},
}

EXPERIENCE_REVIEWS = [
    {
        "author": "Alice",
        "rating": 5,
        "title": "Amazing",
        "text": "Loved it!",
        "date": "2024-03-01",
        "source": "booking_com",
    }
]


def _fake_user():
    user = MagicMock()
    user.user_id = "user-test-123"
    return user


def _client_with_auth() -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: _fake_user()
    return TestClient(app, raise_server_exceptions=False)


def _reset_overrides():
    app.dependency_overrides.clear()


# ─── Tests: /experiences/search ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search_experiences_returns_200_with_results():
    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.experiences.booking_com_service.search_attractions",
            new_callable=AsyncMock,
            return_value=[EXPERIENCE_OFFER],
        ):
            resp = client.post("/api/v1/experiences/search", json={"location": "Tokyo"})
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["name"] == "Senso-ji Temple Tour"
    assert data[0]["provider"] == "booking_com"


@pytest.mark.asyncio
async def test_search_experiences_results_sorted_by_score_descending():
    low_rated = {**EXPERIENCE_OFFER, "id": "exp_low", "review_score": 3.0}
    high_rated = {**EXPERIENCE_OFFER, "id": "exp_high", "review_score": 4.9}
    no_score = {**EXPERIENCE_OFFER, "id": "exp_none", "review_score": None}

    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.experiences.booking_com_service.search_attractions",
            new_callable=AsyncMock,
            return_value=[low_rated, no_score, high_rated],
        ):
            resp = client.post("/api/v1/experiences/search", json={"location": "Tokyo"})
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    results = resp.json()
    assert results[0]["id"] == "exp_high"
    assert results[1]["id"] == "exp_low"
    assert results[2]["id"] == "exp_none"


@pytest.mark.asyncio
async def test_search_experiences_returns_empty_list_when_unavailable():
    client = _client_with_auth()
    try:
        with patch(
            "app.api.v1.experiences.booking_com_service.search_attractions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            resp = client.post("/api/v1/experiences/search", json={"location": "Tokyo"})
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_search_experiences_missing_location_returns_422():
    client = _client_with_auth()
    try:
        resp = client.post("/api/v1/experiences/search", json={})
    finally:
        _reset_overrides()

    assert resp.status_code == 422


# ─── Tests: /experiences/detail/{id} ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_experience_detail_returns_200_with_reviews():
    client = _client_with_auth()
    try:
        with (
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_details",
                new_callable=AsyncMock,
                return_value=EXPERIENCE_OFFER,
            ),
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_reviews",
                new_callable=AsyncMock,
                return_value=EXPERIENCE_REVIEWS,
            ),
        ):
            resp = client.get("/api/v1/experiences/detail/attr_001")
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Senso-ji Temple Tour"
    assert len(data["reviews"]) == 1
    assert data["reviews"][0]["author"] == "Alice"


@pytest.mark.asyncio
async def test_get_experience_detail_returns_404_when_not_found():
    client = _client_with_auth()
    try:
        with (
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_details",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_reviews",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            resp = client.get("/api/v1/experiences/detail/nonexistent")
    finally:
        _reset_overrides()

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_experience_detail_still_returns_200_when_reviews_fail():
    """Reviews endpoint failure should not prevent returning the attraction detail."""
    client = _client_with_auth()
    try:
        with (
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_details",
                new_callable=AsyncMock,
                return_value=EXPERIENCE_OFFER,
            ),
            patch(
                "app.api.v1.experiences.booking_com_service.get_attraction_reviews",
                new_callable=AsyncMock,
                side_effect=Exception("reviews API error"),
            ),
        ):
            resp = client.get("/api/v1/experiences/detail/attr_001")
    finally:
        _reset_overrides()

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Senso-ji Temple Tour"
    assert data["reviews"] == []  # graceful empty fallback
