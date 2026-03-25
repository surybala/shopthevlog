"""
hotel_content_service.py
─────────────────────────────────────────────────────────────────────────────
Enriches hotel detail pages with high-quality photos and guest reviews from
third-party sources that LiteAPI doesn't provide.

Primary source  : Google Places API v1 (New)  — up to 10 photos + 5 reviews
Fallback source : Foursquare Places v3        — many photos + tips as reviews

Results are cached in-process for 24 h to avoid hammering quota on repeated
requests for the same hotel.

Usage
-----
    from app.services import hotel_content_service

    enriched = hotel_content_service.enrich_hotel(
        hotel_name="Keio Plaza Hotel Tokyo",
        lat=35.6895,
        lng=139.6917,
    )
    # enriched = {
    #   "photos":   [{"url": "https://…"}, …],
    #   "reviews":  [{"author": "…", "rating": 8.0, "title": None, "text": "…", "date": "2024-03"}, …],
    #   "rating":   4.5,          # out of 5 (Google) or None
    #   "rating_count": 3812,     # total review count or None
    #   "source":   "google",     # "google" | "foursquare" | None
    # }
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── In-process TTL cache ─────────────────────────────────────────────────────

_CACHE_TTL = 86_400  # 24 hours in seconds

_cache: dict[str, tuple[dict, float]] = {}  # key → (data, timestamp)
_cache_lock = threading.Lock()


def _cache_key(hotel_name: str, lat: float | None, lng: float | None) -> str:
    lat_r = round(lat, 4) if lat is not None else "x"
    lng_r = round(lng, 4) if lng is not None else "x"
    return f"{hotel_name.lower().strip()}|{lat_r}|{lng_r}"


def _cache_get(key: str) -> dict | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry[1]) < _CACHE_TTL:
            return entry[0]
        if entry:
            del _cache[key]
    return None


def _cache_set(key: str, data: dict) -> None:
    with _cache_lock:
        _cache[key] = (data, time.time())


# ─── Empty result shape ───────────────────────────────────────────────────────

def _empty() -> dict:
    return {"photos": [], "reviews": [], "rating": None, "rating_count": None, "source": None}


# ─── Google Places (New API v1) ────────────────────────────────────────────────

_GOOGLE_FIELD_MASK = (
    "id,displayName,rating,userRatingCount,editorialSummary,"
    "reviews,photos"
)
_GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
_GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{id}"
_GOOGLE_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{name}/media"


async def _google_fetch_photo_url(client: httpx.AsyncClient, photo_name: str, api_key: str) -> str | None:
    """Resolve a Google Places photo resource name → CDN photo URL."""
    try:
        resp = await client.get(
            _GOOGLE_PHOTO_MEDIA_URL.format(name=photo_name),
            params={"maxHeightPx": 800, "maxWidthPx": 1200, "skipHttpRedirect": "true", "key": api_key},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("photoUri")
    except Exception as exc:
        logger.debug(f"Google photo fetch failed for {photo_name}: {exc}")
        return None


async def _google_enrich(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    """
    Fetch up to 10 photos and 5 reviews from Google Places API v1.
    Returns an enriched dict, or _empty() on any failure.
    """
    api_key = settings.GOOGLE_PLACES_API_KEY
    if not api_key:
        return _empty()

    async with httpx.AsyncClient() as client:
        # ── Step 1: Text search to find the place ID ─────────────────────────
        query = hotel_name
        if lat is not None and lng is not None:
            query = f"{hotel_name} hotel"

        search_body: dict[str, Any] = {
            "textQuery": query,
            "includedType": "lodging",
            "languageCode": "en",
            "maxResultCount": 1,
        }
        if lat is not None and lng is not None:
            search_body["locationBias"] = {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 500.0,
                }
            }

        try:
            resp = await client.post(
                _GOOGLE_TEXT_SEARCH_URL,
                json=search_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": "places.id",
                },
                timeout=10,
            )
            resp.raise_for_status()
            places = resp.json().get("places", [])
        except Exception as exc:
            logger.warning(f"Google Places text search failed for '{hotel_name}': {exc}")
            return _empty()

        if not places:
            logger.debug(f"Google Places: no results for '{hotel_name}'")
            return _empty()

        place_id = places[0].get("id")
        if not place_id:
            return _empty()

        # ── Step 2: Fetch place details (rating, reviews, photo names) ────────
        try:
            resp = await client.get(
                _GOOGLE_PLACE_DETAILS_URL.format(id=place_id),
                headers={
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": _GOOGLE_FIELD_MASK,
                },
                timeout=10,
            )
            resp.raise_for_status()
            place = resp.json()
        except Exception as exc:
            logger.warning(f"Google Places detail fetch failed for place {place_id}: {exc}")
            return _empty()

        # ── Step 3: Resolve photo media URLs in parallel ──────────────────────
        photo_resources = place.get("photos", [])[:10]
        photo_tasks = [
            _google_fetch_photo_url(client, p["name"], api_key)
            for p in photo_resources
            if p.get("name")
        ]
        photo_urls_raw = await asyncio.gather(*photo_tasks)
        photos = [{"url": u} for u in photo_urls_raw if u]

        # ── Step 4: Parse reviews ─────────────────────────────────────────────
        reviews: list[dict] = []
        for r in place.get("reviews", []):
            text = (r.get("text") or {}).get("text", "").strip()
            if not text:
                continue
            author = (r.get("authorAttribution") or {}).get("displayName") or "Guest"
            rating_raw = r.get("rating")  # 1–5 Google scale
            # Convert to 0–10 scale to match LiteAPI / Foursquare convention
            rating = round(float(rating_raw) * 2, 1) if rating_raw is not None else None
            pub_time = r.get("publishTime") or r.get("relativePublishTimeDescription")
            reviews.append({
                "author": author,
                "rating": rating,
                "title": None,
                "text": text,
                "date": pub_time,
                "source": "google",
            })

        google_rating = place.get("rating")  # 1–5 scale
        google_rating_10 = round(google_rating * 2, 1) if google_rating else None
        rating_count = place.get("userRatingCount")

        return {
            "photos": photos,
            "reviews": reviews,
            "rating": google_rating_10,
            "rating_count": rating_count,
            "source": "google" if (photos or reviews) else None,
        }


# ─── Foursquare Places v3 ─────────────────────────────────────────────────────

_FSQ_SEARCH_URL = "https://api.foursquare.com/v3/places/search"
_FSQ_PHOTOS_URL = "https://api.foursquare.com/v3/places/{fsq_id}/photos"
_FSQ_TIPS_URL = "https://api.foursquare.com/v3/places/{fsq_id}/tips"

# Foursquare category for lodging / hotels
_FSQ_HOTEL_CATEGORIES = "19014"


async def _foursquare_enrich(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    """
    Fetch photos and tips (used as reviews) from Foursquare Places API v3.
    Returns an enriched dict, or _empty() on any failure.
    """
    api_key = settings.FOURSQUARE_API_KEY
    if not api_key:
        return _empty()

    headers = {
        "Authorization": api_key,
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(headers=headers) as client:
        # ── Step 1: Search for the venue ─────────────────────────────────────
        params: dict[str, Any] = {
            "query": hotel_name,
            "categories": _FSQ_HOTEL_CATEGORIES,
            "limit": 1,
            "fields": "fsq_id,name,rating,stats",
        }
        if lat is not None and lng is not None:
            params["ll"] = f"{lat},{lng}"
            params["radius"] = 500

        try:
            resp = await client.get(_FSQ_SEARCH_URL, params=params, timeout=10)
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except Exception as exc:
            logger.warning(f"Foursquare search failed for '{hotel_name}': {exc}")
            return _empty()

        if not results:
            logger.debug(f"Foursquare: no results for '{hotel_name}'")
            return _empty()

        venue = results[0]
        fsq_id = venue.get("fsq_id")
        if not fsq_id:
            return _empty()

        fsq_rating = venue.get("rating")  # 0–10 scale
        tip_count = (venue.get("stats") or {}).get("total_tips")

        # ── Step 2: Fetch photos and tips in parallel ─────────────────────────
        async def fetch_photos() -> list[dict]:
            try:
                r = await client.get(
                    _FSQ_PHOTOS_URL.format(fsq_id=fsq_id),
                    params={"limit": 12, "sort": "POPULAR"},
                    timeout=10,
                )
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                logger.debug(f"Foursquare photos fetch failed for {fsq_id}: {exc}")
                return []

        async def fetch_tips() -> list[dict]:
            try:
                r = await client.get(
                    _FSQ_TIPS_URL.format(fsq_id=fsq_id),
                    params={"limit": 10, "sort": "POPULAR", "fields": "text,created_at,user"},
                    timeout=10,
                )
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                logger.debug(f"Foursquare tips fetch failed for {fsq_id}: {exc}")
                return []

        raw_photos, raw_tips = await asyncio.gather(fetch_photos(), fetch_tips())

        # ── Step 3: Build photos list ─────────────────────────────────────────
        photos: list[dict] = []
        for p in raw_photos:
            prefix = p.get("prefix", "")
            suffix = p.get("suffix", "")
            if prefix and suffix:
                photos.append({"url": f"{prefix}original{suffix}"})

        # ── Step 4: Build reviews list from tips ──────────────────────────────
        reviews: list[dict] = []
        for tip in raw_tips:
            text = (tip.get("text") or "").strip()
            if not text:
                continue
            user = tip.get("user") or {}
            first = user.get("firstName") or ""
            last = user.get("lastName") or ""
            author = (f"{first} {last}").strip() or "Guest"
            reviews.append({
                "author": author,
                "rating": None,   # Foursquare tips don't carry individual ratings
                "title": None,
                "text": text,
                "date": tip.get("created_at"),
                "source": "foursquare",
            })

        return {
            "photos": photos,
            "reviews": reviews,
            "rating": fsq_rating,
            "rating_count": tip_count,
            "source": "foursquare" if (photos or reviews) else None,
        }


# ─── Public entry-point ───────────────────────────────────────────────────────

def enrich_hotel(
    hotel_name: str,
    lat: float | None = None,
    lng: float | None = None,
) -> dict:
    """
    Synchronous wrapper: enriches hotel data with external photos/reviews.

    Tries Google Places first; falls back to Foursquare if Google yields nothing
    (e.g. API key not set or hotel not found). Results are cached 24 h in-process.

    Returns:
        {
          "photos":       list[{"url": str}],
          "reviews":      list[{"author", "rating", "title", "text", "date", "source"}],
          "rating":       float | None,     # 0–10 scale
          "rating_count": int | None,
          "source":       "google" | "foursquare" | None,
        }
    """
    if not hotel_name:
        return _empty()

    key = _cache_key(hotel_name, lat, lng)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # Run the async enrichment in a fresh event loop (this is called from a
    # synchronous FastAPI endpoint running in a threadpool).
    try:
        result = asyncio.run(_enrich_async(hotel_name, lat, lng))
    except Exception as exc:
        logger.error(f"hotel_content_service.enrich_hotel failed: {exc}", exc_info=True)
        result = _empty()

    _cache_set(key, result)
    return result


async def _enrich_async(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    """Try Google, then Foursquare, return whichever has content."""
    result = await _google_enrich(hotel_name, lat, lng)
    if result["source"]:
        return result

    logger.debug(f"Google yielded nothing for '{hotel_name}', trying Foursquare…")
    result = await _foursquare_enrich(hotel_name, lat, lng)
    return result
