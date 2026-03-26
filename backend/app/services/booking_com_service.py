"""
booking_com_service.py — Booking.com Demand API integration.

Covers:
  - Hotel search + detail + availability + prebook (preview_order) + book (create_order) + cancel
  - Car rental search
  - Experiences / attractions search + detail + reviews

All public functions are async and normalise responses to the same internal
shapes used by liteapi_service / duffel_service so the rest of the app is
provider-agnostic.

Rate limiting
-------------
Every function calls ``await booking_com_bucket.acquire()`` before any HTTP
request.  The token bucket (app.core.rate_limit) guarantees we never exceed
the configured RPM limit (default 45 RPM, just below sandbox's 50 RPM cap).

HTTP 429 handling
-----------------
On a 429 response we log a warning, wait 60 s, and retry exactly once.  A
second 429 is re-raised so the caller can decide how to handle it.

Graceful no-op
--------------
If BOOKING_COM_API_TOKEN or BOOKING_COM_AFFILIATE_ID are not configured the
service logs an info message and returns empty results immediately — the app
still works via LiteAPI/Duffel.

Sandbox vs Production
---------------------
BOOKING_COM_SANDBOX=true  →  https://demandapi-sandbox.booking.com
BOOKING_COM_SANDBOX=false →  https://demandapi.booking.com
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.rate_limit import booking_com_bucket

logger = logging.getLogger(__name__)

# ─── Base URL ─────────────────────────────────────────────────────────────────

_BASE = (
    "https://demandapi-sandbox.booking.com"
    if settings.BOOKING_COM_SANDBOX
    else "https://demandapi.booking.com"
)


# ─── Auth helpers ─────────────────────────────────────────────────────────────


def _has_credentials() -> bool:
    return bool(settings.BOOKING_COM_API_TOKEN and settings.BOOKING_COM_AFFILIATE_ID)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.BOOKING_COM_API_TOKEN}",
        "X-Affiliate-Id": settings.BOOKING_COM_AFFILIATE_ID,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


# ─── HTTP helper with 429 retry ───────────────────────────────────────────────


async def _post(client: httpx.AsyncClient, url: str, body: dict) -> dict:
    """POST with one automatic 429 retry after 60 s."""
    resp = await client.post(url, json=body, headers=_headers(), timeout=15)
    if resp.status_code == 429:
        logger.warning("Booking.com 429 on POST %s — waiting 60 s then retrying", url)
        await asyncio.sleep(60)
        resp = await client.post(url, json=body, headers=_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json()


async def _get(client: httpx.AsyncClient, url: str, params: dict | None = None) -> dict:
    """GET with one automatic 429 retry after 60 s."""
    resp = await client.get(url, params=params, headers=_headers(), timeout=15)
    if resp.status_code == 429:
        logger.warning("Booking.com 429 on GET %s — waiting 60 s then retrying", url)
        await asyncio.sleep(60)
        resp = await client.get(url, params=params, headers=_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json()


# ─── Normalisation helpers ────────────────────────────────────────────────────


def _safe_photo(raw_photo: Any) -> dict | None:
    """Extract a {url} dict from various photo shapes Booking.com may return."""
    if isinstance(raw_photo, str) and raw_photo:
        return {"url": raw_photo}
    if isinstance(raw_photo, dict):
        url = (
            raw_photo.get("url")
            or raw_photo.get("uri")
            or raw_photo.get("photo_url")
            or ""
        )
        if url:
            return {"url": url}
    return None


def _normalize_hotel_offer(
    raw: dict,
    check_in: str,
    check_out: str,
    adults: int,
    rooms: int,
) -> dict:
    """Map a Booking.com accommodation search result to our HotelOffer shape."""
    acc = raw.get("accommodation") or raw
    acc_id = str(acc.get("id") or raw.get("id") or "")

    # Extract cheapest product price
    products: list[dict] = raw.get("products") or []
    cheapest_price: str = "0"
    cheapest_currency: str = "USD"
    room_types: list[dict] = []
    for p in products:
        price = p.get("price") or {}
        book_price = str(price.get("book") or price.get("total") or "0")
        currency = str(price.get("currency") or "USD")
        if cheapest_price == "0" or (
            book_price != "0" and float(book_price) < float(cheapest_price)
        ):
            cheapest_price = book_price
            cheapest_currency = currency

        # Build a minimal room type entry for each product
        room_types.append(
            {
                "id": f"booking_com_{acc_id}_{p.get('id') or p.get('product_id') or len(room_types)}",
                "name": p.get("name") or p.get("room_name") or "Room",
                "max_occupancy": p.get("max_occupancy") or adults,
                "price_total": book_price,
                "price_per_night": str(
                    round(float(book_price) / max(1, _nights(check_in, check_out)), 2)
                ),
                "currency": currency,
                "is_cheapest": False,
                "cancellation_type": _cancellation_label(p),
                "board_type": p.get("meal_plan") or p.get("board_type") or "room_only",
            }
        )

    # Mark cheapest room
    if room_types:
        min_price = min(float(r["price_total"]) for r in room_types)
        for r in room_types:
            r["is_cheapest"] = float(r["price_total"]) == min_price

    photos = [p for p in (_safe_photo(ph) for ph in (acc.get("photos") or [])) if p]

    return {
        "id": f"booking_com_{acc_id}",
        "provider": "booking_com",
        "hotel_id": acc_id,
        "accommodation": {
            "id": acc_id,
            "name": acc.get("name") or acc.get("display_name") or "Hotel",
            "rating": acc.get("review_score") or acc.get("star_rating"),
            "stars": acc.get("star_rating"),
            "address": _build_address(acc),
            "city": acc.get("city") or "",
            "country": acc.get("country") or "",
            "latitude": acc.get("latitude") or acc.get("location", {}).get("latitude"),
            "longitude": acc.get("longitude") or acc.get("location", {}).get("longitude"),
            "photos": photos,
            "amenities": acc.get("facilities") or acc.get("amenities") or [],
        },
        "cheapest_rate_total_amount": cheapest_price,
        "cheapest_rate_currency": cheapest_currency,
        "check_in": check_in,
        "check_out": check_out,
        "guests": adults,
        "rooms": rooms,
        "room_types": room_types,
    }


def _normalize_hotel_detail(raw: dict) -> dict:
    """Map a Booking.com accommodation detail response to our HotelDetail shape."""
    photos = [p for p in (_safe_photo(ph) for ph in (raw.get("photos") or [])) if p]
    amenities: list[str] = []
    for fac in raw.get("facilities") or raw.get("amenities") or []:
        if isinstance(fac, str):
            amenities.append(fac)
        elif isinstance(fac, dict):
            name = fac.get("name") or fac.get("title") or ""
            if name:
                amenities.append(name)

    return {
        "hotel_id": str(raw.get("id") or ""),
        "description": raw.get("description") or raw.get("editorial_summary") or "",
        "amenities": amenities,
        "photos": photos,
        "review_score": raw.get("review_score"),
        "review_count": raw.get("review_count") or raw.get("user_rating_count"),
        "check_in_time": raw.get("check_in_time") or "",
        "check_out_time": raw.get("check_out_time") or "",
        "reviews": [],  # detail endpoint doesn't include reviews; use hotel_content_service
        "provider": "booking_com",
    }


def _normalize_car_offer(raw: dict) -> dict:
    """Map a Booking.com car search result to our CarOffer shape."""
    car = raw.get("vehicle") or raw
    price_info = raw.get("price") or {}
    photos = [p for p in (_safe_photo(ph) for ph in (car.get("photos") or [])) if p]
    features: list[str] = []
    for feat in car.get("features") or car.get("equipment") or []:
        if isinstance(feat, str):
            features.append(feat)
        elif isinstance(feat, dict):
            name = feat.get("name") or feat.get("title") or ""
            if name:
                features.append(name)

    return {
        "id": f"booking_com_car_{raw.get('id') or raw.get('car_id') or ''}",
        "provider": "booking_com",
        "car_category": car.get("category") or car.get("class") or "Standard",
        "car_model": car.get("model") or car.get("name"),
        "supplier": raw.get("supplier") or raw.get("vendor"),
        "pickup_location": str(raw.get("pickup_location") or ""),
        "dropoff_location": str(raw.get("dropoff_location") or raw.get("pickup_location") or ""),
        "pickup_datetime": str(raw.get("pickup_datetime") or raw.get("pickup_time") or ""),
        "dropoff_datetime": str(raw.get("dropoff_datetime") or raw.get("return_time") or ""),
        "total_amount": str(price_info.get("total") or price_info.get("book") or "0"),
        "currency": str(price_info.get("currency") or "USD"),
        "passengers": int(car.get("passengers") or car.get("seats") or 4),
        "bags": car.get("bags") or car.get("luggage"),
        "photos": photos,
        "features": features,
        "cancellation_type": _cancellation_label(raw),
        "metadata": {"raw": raw},
    }


def _normalize_experience(raw: dict) -> dict:
    """Map a Booking.com attraction result to our ExperienceOffer shape."""
    photos = [p for p in (_safe_photo(ph) for ph in (raw.get("photos") or [])) if p]
    price_info = raw.get("price") or {}
    location = raw.get("location") or {}

    return {
        "id": f"booking_com_exp_{raw.get('id') or raw.get('attraction_id') or ''}",
        "provider": "booking_com",
        "name": raw.get("name") or raw.get("title") or "Experience",
        "description": raw.get("description") or raw.get("editorial_summary") or "",
        "category": raw.get("category") or raw.get("type"),
        "location": (
            location.get("city")
            or location.get("address")
            or raw.get("city")
            or ""
        ),
        "lat": location.get("latitude") or raw.get("latitude"),
        "lng": location.get("longitude") or raw.get("longitude"),
        "photos": photos,
        "review_score": raw.get("review_score"),
        "review_count": raw.get("review_count") or raw.get("user_rating_count"),
        "min_price": str(price_info.get("from") or price_info.get("min") or ""),
        "currency": str(price_info.get("currency") or "USD"),
        "duration_minutes": raw.get("duration_minutes") or raw.get("duration"),
        "metadata": {"raw_id": raw.get("id") or raw.get("attraction_id")},
    }


# ─── Private utilities ────────────────────────────────────────────────────────


def _nights(check_in: str, check_out: str) -> int:
    from datetime import date

    try:
        ci = date.fromisoformat(check_in)
        co = date.fromisoformat(check_out)
        return max(1, (co - ci).days)
    except Exception:
        return 1


def _cancellation_label(product: dict) -> str:
    ct = product.get("cancellation_type") or product.get("cancellation") or ""
    if isinstance(ct, dict):
        ct = ct.get("type") or ct.get("label") or ""
    ct = str(ct).lower()
    if "free" in ct or "refund" in ct:
        return "free_cancellation"
    if "non" in ct or "no_refund" in ct:
        return "non_refundable"
    return "unknown"


def _build_address(acc: dict) -> str:
    parts = [
        acc.get("address") or acc.get("street"),
        acc.get("city"),
        acc.get("country"),
    ]
    return ", ".join(p for p in parts if p)


# ─── Public API: Hotels ───────────────────────────────────────────────────────


async def search_hotels(
    location: str | tuple[float, float],
    check_in: str,
    check_out: str,
    adults: int = 2,
    rooms: int = 1,
    children: list[int] | None = None,
    currency: str = "USD",
) -> list[dict]:
    """Search accommodations via Booking.com.

    Args:
        location: City name string OR (latitude, longitude) tuple.
        check_in: ISO date string (YYYY-MM-DD).
        check_out: ISO date string (YYYY-MM-DD).
        adults: Number of adult guests.
        rooms: Number of rooms needed.
        children: Optional list of child ages.
        currency: 3-letter currency code.

    Returns:
        List of normalised HotelOffer dicts (same shape as liteapi_service).
        Returns [] if credentials are missing or on any API error.
    """
    if not _has_credentials():
        logger.info("Booking.com credentials not configured — skipping hotel search")
        return []

    await booking_com_bucket.acquire()

    guests: dict[str, Any] = {"adults": adults, "rooms": rooms}
    if children:
        guests["children"] = [{"age": a} for a in children]

    body: dict[str, Any] = {
        "checkin": check_in,
        "checkout": check_out,
        "guests": guests,
        "booker": {"country": "US", "platform": "desktop"},
        "currency": currency,
        "sort": {"by": "price", "direction": "asc"},
        "rows": 20,
    }

    if isinstance(location, tuple):
        lat, lng = location
        body["coordinates"] = {"latitude": lat, "longitude": lng, "radius": 5000}
    else:
        body["city"] = location

    try:
        data = await _post_with_client(f"{_BASE}/3.1/accommodations/search", body)
        results = data.get("accommodations") or data.get("results") or []
        return [
            _normalize_hotel_offer(r, check_in, check_out, adults, rooms)
            for r in results
        ]
    except Exception as exc:
        logger.warning("Booking.com hotel search failed: %s", exc)
        return []


async def get_hotel_details(hotel_id: str) -> dict | None:
    """Fetch full accommodation details from Booking.com.

    Returns a normalised HotelDetail dict or None on error.
    """
    if not _has_credentials():
        return None

    await booking_com_bucket.acquire()

    try:
        data = await _get_with_client(f"{_BASE}/3.1/accommodations/{hotel_id}")
        return _normalize_hotel_detail(data)
    except Exception as exc:
        logger.warning("Booking.com hotel detail failed for %s: %s", hotel_id, exc)
        return None


async def check_availability(
    hotel_id: str,
    check_in: str,
    check_out: str,
    adults: int = 2,
    rooms: int = 1,
) -> dict | None:
    """Check real-time availability and confirmed pricing for a specific property."""
    if not _has_credentials():
        return None

    await booking_com_bucket.acquire()

    body = {
        "accommodation_id": hotel_id,
        "checkin": check_in,
        "checkout": check_out,
        "guests": {"adults": adults, "rooms": rooms},
        "booker": {"country": "US", "platform": "desktop"},
    }
    try:
        return await _post_with_client(f"{_BASE}/3.1/accommodations/availability", body)
    except Exception as exc:
        logger.warning("Booking.com availability check failed for %s: %s", hotel_id, exc)
        return None


async def preview_order(
    accommodation_id: str,
    product_id: str,
    guests: list[dict],
) -> dict | None:
    """Preview a booking (Booking.com's prebook equivalent).

    Returns the preview response dict which contains a token required for
    ``create_order``.  Returns None on error.
    """
    if not _has_credentials():
        return None

    await booking_com_bucket.acquire()

    body = {
        "accommodation_id": accommodation_id,
        "product_id": product_id,
        "guests": guests,
        "booker": {"country": "US", "platform": "desktop"},
    }
    try:
        return await _post_with_client(f"{_BASE}/orders/preview", body)
    except Exception as exc:
        logger.warning("Booking.com preview_order failed: %s", exc)
        return None


async def create_order(
    preview_token: str,
    guests: list[dict],
    booker: dict,
) -> dict | None:
    """Create a Booking.com order (final booking step).

    Args:
        preview_token: Token returned by ``preview_order``.
        guests: List of guest dicts (title, first_name, last_name, email, phone).
        booker: Booker info dict (country, platform, …).

    Returns:
        Order dict with ``order_id`` field, or None on error.
    """
    if not _has_credentials():
        return None

    await booking_com_bucket.acquire()

    body = {
        "preview_token": preview_token,
        "guests": guests,
        "booker": booker,
    }
    try:
        return await _post_with_client(f"{_BASE}/orders/create", body)
    except Exception as exc:
        logger.warning("Booking.com create_order failed: %s", exc)
        return None


async def cancel_order(order_id: str) -> bool:
    """Cancel a Booking.com order.  Returns True on success, False on failure."""
    if not _has_credentials():
        return False

    await booking_com_bucket.acquire()

    try:
        await _post_with_client(f"{_BASE}/orders/{order_id}/cancel", {})
        return True
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("Booking.com cancel: order %s not found", order_id)
        else:
            logger.warning("Booking.com cancel_order failed for %s: %s", order_id, exc)
        return False
    except Exception as exc:
        logger.warning("Booking.com cancel_order failed for %s: %s", order_id, exc)
        return False


# ─── Public API: Cars ─────────────────────────────────────────────────────────


async def search_cars(
    pickup_location: str,
    dropoff_location: str | None = None,
    pickup_datetime: str = "",
    dropoff_datetime: str = "",
    driver_age: int = 30,
    currency: str = "USD",
) -> list[dict]:
    """Search car rentals via Booking.com Cars API (early-access).

    Returns a list of normalised CarOffer dicts, or [] on error / no credentials.
    """
    if not _has_credentials():
        logger.info("Booking.com credentials not configured — skipping car search")
        return []

    await booking_com_bucket.acquire()

    body: dict[str, Any] = {
        "pickup_location": pickup_location,
        "dropoff_location": dropoff_location or pickup_location,
        "pickup_datetime": pickup_datetime,
        "dropoff_datetime": dropoff_datetime,
        "driver": {"age": driver_age},
        "currency": currency,
    }
    try:
        data = await _post_with_client(f"{_BASE}/3.1/cars/search", body)
        results = data.get("cars") or data.get("results") or []
        return [_normalize_car_offer(r) for r in results]
    except Exception as exc:
        logger.warning("Booking.com car search failed: %s", exc)
        return []


# ─── Public API: Experiences / Attractions ───────────────────────────────────


async def search_attractions(
    location: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    filters: dict | None = None,
) -> list[dict]:
    """Search experiences/attractions via Booking.com Attractions API (beta).

    Returns a list of normalised ExperienceOffer dicts, or [] on error.
    """
    if not _has_credentials():
        logger.info("Booking.com credentials not configured — skipping attractions search")
        return []

    await booking_com_bucket.acquire()

    body: dict[str, Any] = {}
    if lat is not None and lng is not None:
        body["coordinates"] = {"latitude": lat, "longitude": lng}
    elif location:
        body["city"] = location
    if filters:
        body.update(filters)

    try:
        data = await _post_with_client(f"{_BASE}/3.1/attractions/search", body)
        results = data.get("attractions") or data.get("results") or []
        return [_normalize_experience(r) for r in results]
    except Exception as exc:
        logger.warning("Booking.com attractions search failed: %s", exc)
        return []


async def get_attraction_details(attraction_id: str) -> dict | None:
    """Fetch full attraction details from Booking.com."""
    if not _has_credentials():
        return None

    await booking_com_bucket.acquire()

    try:
        data = await _get_with_client(f"{_BASE}/3.1/attractions/{attraction_id}")
        return _normalize_experience(data)
    except Exception as exc:
        logger.warning(
            "Booking.com attraction detail failed for %s: %s", attraction_id, exc
        )
        return None


async def get_attraction_reviews(
    attraction_id: str,
    rows: int = 10,
) -> list[dict]:
    """Fetch reviews for an attraction.

    Returns a list of review dicts compatible with HotelReview shape.
    """
    if not _has_credentials():
        return []

    await booking_com_bucket.acquire()

    try:
        data = await _get_with_client(
            f"{_BASE}/3.1/attractions/{attraction_id}/reviews",
            params={"rows": rows},
        )
        raw_reviews = data.get("reviews") or data.get("results") or []
        reviews: list[dict] = []
        for r in raw_reviews:
            text = (r.get("text") or r.get("content") or r.get("review") or "").strip()
            if not text:
                continue
            reviews.append(
                {
                    "author": r.get("author") or r.get("reviewer_name"),
                    "rating": r.get("rating") or r.get("score"),
                    "title": r.get("title"),
                    "text": text,
                    "date": r.get("date") or r.get("created_at"),
                    "source": "booking_com",
                }
            )
        return reviews
    except Exception as exc:
        logger.warning(
            "Booking.com attraction reviews failed for %s: %s", attraction_id, exc
        )
        return []


# ─── Internal HTTP wrappers (share one client per call-site) ─────────────────


async def _post_with_client(url: str, body: dict) -> dict:
    async with httpx.AsyncClient() as client:
        return await _post(client, url, body)


async def _get_with_client(url: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient() as client:
        return await _get(client, url, params)
