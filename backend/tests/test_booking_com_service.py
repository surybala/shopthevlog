"""
Tests for app.services.booking_com_service.

All Booking.com HTTP calls are mocked via pytest-asyncio + unittest.mock.
No real network calls are made.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _mock_httpx_response(status: int, body: dict) -> MagicMock:
    """Build a mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.json.return_value = body
    if status >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status}", request=MagicMock(), response=resp
        )
    else:
        resp.raise_for_status.return_value = None
    return resp


def _mock_async_client(responses: list[MagicMock]):
    """Return an async context manager whose client returns responses in order."""
    client = AsyncMock()
    client.post = AsyncMock(side_effect=responses)
    client.get = AsyncMock(side_effect=responses)
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx, client


# ─── Fixtures ─────────────────────────────────────────────────────────────────

HOTEL_SEARCH_RESPONSE = {
    "accommodations": [
        {
            "id": "12345",
            "name": "Grand Hotel Tokyo",
            "star_rating": 5,
            "review_score": 9.2,
            "latitude": 35.6762,
            "longitude": 139.6503,
            "city": "Tokyo",
            "country": "JP",
            "address": "1-1 Shinjuku",
            "photos": [{"url": "https://example.com/photo1.jpg"}],
            "facilities": ["WiFi", "Pool"],
            "products": [
                {
                    "id": "prod_a",
                    "name": "Deluxe King",
                    "max_occupancy": 2,
                    "price": {"book": "250.00", "currency": "USD"},
                    "cancellation_type": "free_cancellation",
                    "meal_plan": "breakfast",
                }
            ],
        }
    ]
}

HOTEL_DETAIL_RESPONSE = {
    "id": "12345",
    "name": "Grand Hotel Tokyo",
    "description": "A luxurious hotel in the heart of Tokyo.",
    "star_rating": 5,
    "review_score": 9.2,
    "review_count": 1234,
    "photos": [{"url": "https://example.com/photo1.jpg"}],
    "facilities": ["WiFi", "Pool", "Spa"],
}

CAR_SEARCH_RESPONSE = {
    "cars": [
        {
            "id": "car_001",
            "vehicle": {
                "category": "Economy",
                "model": "Toyota Yaris",
                "passengers": 4,
                "bags": 2,
                "photos": [{"url": "https://example.com/car.jpg"}],
                "features": ["AC", "Automatic"],
            },
            "supplier": "Hertz",
            "pickup_location": "Tokyo Airport",
            "dropoff_location": "Tokyo Airport",
            "pickup_datetime": "2024-06-01T10:00:00",
            "dropoff_datetime": "2024-06-05T10:00:00",
            "price": {"total": "180.00", "currency": "USD"},
            "cancellation_type": "free_cancellation",
        }
    ]
}

ATTRACTIONS_SEARCH_RESPONSE = {
    "attractions": [
        {
            "id": "attr_001",
            "name": "Senso-ji Temple Tour",
            "description": "Historic temple in Asakusa.",
            "category": "Cultural",
            "location": {"city": "Tokyo", "latitude": 35.7148, "longitude": 139.7967},
            "photos": [{"url": "https://example.com/temple.jpg"}],
            "review_score": 4.8,
            "review_count": 500,
            "price": {"from": "25.00", "currency": "USD"},
            "duration_minutes": 120,
        }
    ]
}

ATTRACTION_DETAIL_RESPONSE = {
    "id": "attr_001",
    "name": "Senso-ji Temple Tour",
    "description": "Historic temple in Asakusa.",
    "category": "Cultural",
    "location": {"city": "Tokyo", "latitude": 35.7148, "longitude": 139.7967},
    "photos": [{"url": "https://example.com/temple.jpg"}],
    "review_score": 4.8,
    "review_count": 500,
    "price": {"from": "25.00", "currency": "USD"},
    "duration_minutes": 120,
}

ATTRACTION_REVIEWS_RESPONSE = {
    "reviews": [
        {
            "author": "Alice",
            "rating": 5,
            "title": "Amazing experience",
            "text": "Absolutely loved visiting this temple. Very serene.",
            "date": "2024-03-01",
        },
        {
            "author": "Bob",
            "rating": 4,
            "title": None,
            "text": "Beautiful place but crowded in the morning.",
            "date": "2024-02-15",
        },
    ]
}

PREVIEW_ORDER_RESPONSE = {"token": "preview_tok_abc123", "expires_at": "2024-06-01T12:00:00Z"}

CREATE_ORDER_RESPONSE = {"order_id": "bcom_order_xyz789", "status": "confirmed"}


# ─── Tests: search_hotels ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search_hotels_returns_normalized_offers():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value=HOTEL_SEARCH_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_hotels

        results = await search_hotels("Tokyo", "2024-06-01", "2024-06-06", adults=2)

    assert len(results) == 1
    offer = results[0]
    assert offer["provider"] == "booking_com"
    assert offer["hotel_id"] == "12345"
    assert offer["accommodation"]["name"] == "Grand Hotel Tokyo"
    assert offer["cheapest_rate_total_amount"] == "250.00"
    assert offer["cheapest_rate_currency"] == "USD"
    assert len(offer["room_types"]) == 1
    assert offer["room_types"][0]["cancellation_type"] == "free_cancellation"


@pytest.mark.asyncio
async def test_search_hotels_uses_coordinates_when_provided():
    captured_body: dict = {}

    async def capture_post(url, body):
        captured_body.update(body)
        return HOTEL_SEARCH_RESPONSE

    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            side_effect=capture_post,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_hotels

        await search_hotels(
            (35.6762, 139.6503), "2024-06-01", "2024-06-06"
        )

    assert "coordinates" in captured_body
    assert captured_body["coordinates"]["latitude"] == 35.6762
    assert "city" not in captured_body


@pytest.mark.asyncio
async def test_search_hotels_returns_empty_on_http_error():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            side_effect=httpx.HTTPStatusError(
                "500", request=MagicMock(), response=MagicMock(status_code=500)
            ),
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_hotels

        results = await search_hotels("Tokyo", "2024-06-01", "2024-06-06")

    assert results == []


@pytest.mark.asyncio
async def test_search_hotels_returns_empty_when_no_credentials():
    with patch("app.services.booking_com_service._has_credentials", return_value=False):
        from app.services.booking_com_service import search_hotels

        results = await search_hotels("Tokyo", "2024-06-01", "2024-06-06")

    assert results == []


# ─── Tests: get_hotel_details ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_hotel_details_maps_fields():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._get_with_client",
            new_callable=AsyncMock,
            return_value=HOTEL_DETAIL_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import get_hotel_details

        detail = await get_hotel_details("12345")

    assert detail is not None
    assert detail["hotel_id"] == "12345"
    assert detail["description"] == "A luxurious hotel in the heart of Tokyo."
    assert "WiFi" in detail["amenities"]
    assert len(detail["photos"]) == 1
    assert detail["review_score"] == 9.2
    assert detail["provider"] == "booking_com"


@pytest.mark.asyncio
async def test_get_hotel_details_returns_none_on_error():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._get_with_client",
            new_callable=AsyncMock,
            side_effect=Exception("connection error"),
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import get_hotel_details

        result = await get_hotel_details("12345")

    assert result is None


# ─── Tests: preview_order / create_order / cancel_order ─────────────────────


@pytest.mark.asyncio
async def test_preview_order_returns_token():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value=PREVIEW_ORDER_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import preview_order

        result = await preview_order("12345", "prod_a", [{"first_name": "Jane"}])

    assert result is not None
    assert result["token"] == "preview_tok_abc123"


@pytest.mark.asyncio
async def test_create_order_returns_order_id():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value=CREATE_ORDER_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import create_order

        result = await create_order(
            "preview_tok_abc123",
            [{"first_name": "Jane", "last_name": "Doe"}],
            {"country": "US", "platform": "desktop"},
        )

    assert result is not None
    assert result["order_id"] == "bcom_order_xyz789"


@pytest.mark.asyncio
async def test_cancel_order_returns_true_on_success():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value={"status": "cancelled"},
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import cancel_order

        result = await cancel_order("bcom_order_xyz789")

    assert result is True


@pytest.mark.asyncio
async def test_cancel_order_returns_false_on_404():
    not_found = MagicMock(spec=httpx.Response, status_code=404)
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            side_effect=httpx.HTTPStatusError(
                "404 Not Found", request=MagicMock(), response=not_found
            ),
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import cancel_order

        result = await cancel_order("nonexistent_order")

    assert result is False


# ─── Tests: search_cars ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search_cars_returns_normalized_offers():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value=CAR_SEARCH_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_cars

        results = await search_cars(
            "Tokyo Airport",
            pickup_datetime="2024-06-01T10:00:00",
            dropoff_datetime="2024-06-05T10:00:00",
        )

    assert len(results) == 1
    car = results[0]
    assert car["provider"] == "booking_com"
    assert car["car_category"] == "Economy"
    assert car["car_model"] == "Toyota Yaris"
    assert car["total_amount"] == "180.00"
    assert "AC" in car["features"]
    assert car["cancellation_type"] == "free_cancellation"


@pytest.mark.asyncio
async def test_search_cars_returns_empty_on_error():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            side_effect=Exception("API unavailable"),
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_cars

        results = await search_cars("Tokyo Airport")

    assert results == []


# ─── Tests: search_attractions / get_attraction_details / reviews ─────────────


@pytest.mark.asyncio
async def test_search_attractions_returns_normalized_offers():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value=ATTRACTIONS_SEARCH_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import search_attractions

        results = await search_attractions(location="Tokyo")

    assert len(results) == 1
    exp = results[0]
    assert exp["provider"] == "booking_com"
    assert exp["name"] == "Senso-ji Temple Tour"
    assert exp["category"] == "Cultural"
    assert exp["review_score"] == 4.8
    assert exp["duration_minutes"] == 120


@pytest.mark.asyncio
async def test_get_attraction_detail_maps_fields():
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._get_with_client",
            new_callable=AsyncMock,
            return_value=ATTRACTION_DETAIL_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import get_attraction_details

        detail = await get_attraction_details("attr_001")

    assert detail is not None
    assert detail["name"] == "Senso-ji Temple Tour"
    assert detail["lat"] == 35.7148


@pytest.mark.asyncio
async def test_get_attraction_detail_includes_reviews():
    """get_attraction_reviews returns correctly shaped review dicts."""
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._get_with_client",
            new_callable=AsyncMock,
            return_value=ATTRACTION_REVIEWS_RESPONSE,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import get_attraction_reviews

        reviews = await get_attraction_reviews("attr_001")

    assert len(reviews) == 2
    assert reviews[0]["author"] == "Alice"
    assert reviews[0]["rating"] == 5
    assert reviews[0]["source"] == "booking_com"
    # Reviews with no text should be filtered out
    assert all(r["text"] for r in reviews)


@pytest.mark.asyncio
async def test_get_attraction_reviews_filters_empty_text():
    response_with_empty = {
        "reviews": [
            {"author": "X", "rating": 3, "text": ""},  # should be filtered
            {"author": "Y", "rating": 5, "text": "Great place!"},
        ]
    }
    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch("app.services.booking_com_service.booking_com_bucket") as mock_bucket,
        patch(
            "app.services.booking_com_service._get_with_client",
            new_callable=AsyncMock,
            return_value=response_with_empty,
        ),
    ):
        mock_bucket.acquire = AsyncMock()
        from app.services.booking_com_service import get_attraction_reviews

        reviews = await get_attraction_reviews("attr_001")

    assert len(reviews) == 1
    assert reviews[0]["author"] == "Y"


# ─── Tests: token bucket rate limiting ────────────────────────────────────────


@pytest.mark.asyncio
async def test_token_bucket_delays_when_exhausted():
    """Token bucket sleeps when dry and resumes after tokens refill."""
    from app.core.rate_limit import _AsyncTokenBucket

    # Create a bucket with capacity=1 and a very low rate (1 per minute = 1/60 per s)
    bucket = _AsyncTokenBucket(rate_rpm=1, capacity=1)

    # First acquire should be immediate (full bucket)
    start = time.monotonic()
    await bucket.acquire()
    first_duration = time.monotonic() - start
    assert first_duration < 0.5, "First acquire should not sleep"

    # Second acquire should sleep ~60 s — we only wait up to 0.2 s in the test
    # by patching asyncio.sleep
    slept: list[float] = []

    original_sleep = asyncio.sleep

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)
        # Don't actually sleep — just record the duration
        await original_sleep(0)

    with patch("app.core.rate_limit.asyncio.sleep", side_effect=fake_sleep):
        await bucket.acquire()

    assert len(slept) == 1
    assert slept[0] > 0, "Should have slept a positive duration"


@pytest.mark.asyncio
async def test_token_bucket_first_acquire_is_immediate():
    """A freshly created bucket has a full complement of tokens."""
    from app.core.rate_limit import _AsyncTokenBucket

    bucket = _AsyncTokenBucket(rate_rpm=60, capacity=60)
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    with patch("app.core.rate_limit.asyncio.sleep", side_effect=fake_sleep):
        await bucket.acquire()

    assert slept == [], "Should not sleep when bucket is full"


@pytest.mark.asyncio
async def test_outbound_bucket_called_before_each_request():
    """Every service function must call booking_com_bucket.acquire() before HTTP."""
    acquire_calls = 0

    async def mock_acquire():
        nonlocal acquire_calls
        acquire_calls += 1

    with (
        patch("app.services.booking_com_service._has_credentials", return_value=True),
        patch(
            "app.services.booking_com_service.booking_com_bucket"
        ) as mock_bucket,
        patch(
            "app.services.booking_com_service._post_with_client",
            new_callable=AsyncMock,
            return_value={"accommodations": []},
        ),
    ):
        mock_bucket.acquire = mock_acquire
        from app.services.booking_com_service import search_hotels

        await search_hotels("Tokyo", "2024-06-01", "2024-06-06")

    assert acquire_calls == 1, "acquire() must be called exactly once per search"
