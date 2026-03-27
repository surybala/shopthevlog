"""
hotel_content_service.py
─────────────────────────────────────────────────────────────────────────────
Enriches hotel detail pages with high-quality photos and guest reviews from
third-party sources that LiteAPI doesn't provide.

Sources
-------
Primary  : Google Places API v1 (New)  — up to 10 photos + 5 reviews
Fallback : Foursquare Places v3        — many photos + tips as reviews

Cache hierarchy
---------------
L1  In-process dict, 1 h TTL   — avoids repeated DB round-trips per session
L2  Supabase ``hotel_content`` table, 7-day TTL — persists across restarts
                                                    and accumulates content

On each external fetch the new photos/reviews are **merged** (union) with the
existing DB row so the gallery grows over time rather than being replaced.

Usage
-----
    from app.services import hotel_content_service

    enriched = hotel_content_service.enrich_hotel(
        hotel_id="liteapi_hotel_abc123",
        hotel_name="Keio Plaza Hotel Tokyo",
        lat=35.6895,
        lng=139.6917,
    )
    # enriched = {
    #   "photos":       [{"url": "https://…"}, …],
    #   "reviews":      [{"author": "…", "rating": 8.0, "text": "…", …}, …],
    #   "review_score": 8.6,
    #   "review_count": 3812,
    #   "source":       "google",
    # }
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.db.client import get_supabase

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

_L1_TTL = 3_600        # 1 hour — in-process cache; DB is the source of truth
_L2_TTL_DAYS = 7       # 7 days — re-fetch from external APIs when older than this
_MAX_PHOTOS = 50       # maximum photos to accumulate per hotel
_MAX_REVIEWS = 30      # maximum reviews to accumulate per hotel

# ─── L1 in-process cache ─────────────────────────────────────────────────────

_cache: dict[str, tuple[dict, float]] = {}  # hotel_id → (data, timestamp)
_cache_lock = threading.Lock()


def _l1_get(hotel_id: str) -> dict | None:
    with _cache_lock:
        entry = _cache.get(hotel_id)
        if entry and (time.time() - entry[1]) < _L1_TTL:
            return entry[0]
        if entry:
            del _cache[hotel_id]
    return None


def _l1_set(hotel_id: str, data: dict) -> None:
    with _cache_lock:
        _cache[hotel_id] = (data, time.time())


# ─── Empty result shape ───────────────────────────────────────────────────────

def _empty() -> dict:
    return {
        "photos": [],
        "reviews": [],
        "review_score": None,
        "review_count": None,
        "source": None,
    }


# ─── Supabase (L2) helpers ────────────────────────────────────────────────────

def _db_load(hotel_id: str) -> dict | None:
    """Return the stored hotel_content row for hotel_id, or None if not found."""
    try:
        db = get_supabase()
        resp = (
            db.table("hotel_content")
            .select("*")
            .eq("hotel_id", hotel_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as exc:
        logger.warning(f"hotel_content DB load failed for {hotel_id}: {exc}")
        return None


def _db_is_fresh(row: dict, ttl_days: int = _L2_TTL_DAYS) -> bool:
    """Return True if the row was enriched within ttl_days."""
    try:
        last = row.get("last_enriched_at")
        if not last:
            return False
        if isinstance(last, str):
            last = datetime.fromisoformat(last.replace("Z", "+00:00"))
        age_s = (datetime.now(timezone.utc) - last).total_seconds()
        return age_s < ttl_days * 86_400
    except Exception:
        return False


def _merge_photos(existing: list[dict], new: list[dict]) -> list[dict]:
    """Union existing + new photos, deduplicated by stable ref then URL, capped at _MAX_PHOTOS.

    Google Places photo URIs are signed CDN URLs that can change between API
    calls for the same underlying photo.  We store the stable photo resource
    name as ``ref`` (e.g. ``places/ChIJ.../photos/AUacShh...``) and use that
    as the primary dedup key.  Foursquare and LiteAPI photos have no ``ref``,
    so they fall back to URL-based dedup.
    """
    seen_refs: set[str] = {p["ref"] for p in existing if p.get("ref")}
    seen_urls: set[str] = {p["url"] for p in existing if p.get("url") and not p.get("ref")}
    merged = list(existing)
    for p in new:
        ref = p.get("ref", "")
        url = p.get("url", "")
        if ref:
            if ref not in seen_refs:
                merged.append(p)
                seen_refs.add(ref)
        elif url:
            if url not in seen_urls:
                merged.append(p)
                seen_urls.add(url)
    return merged[:_MAX_PHOTOS]


def _merge_reviews(existing: list[dict], new: list[dict]) -> list[dict]:
    """Union existing + new reviews, deduplicated by text, capped at _MAX_REVIEWS."""
    seen: set[str] = {r.get("text", "") for r in existing if r.get("text")}
    merged = list(existing)
    for r in new:
        text = r.get("text", "")
        if text and text not in seen:
            merged.append(r)
            seen.add(text)
    return merged[:_MAX_REVIEWS]


def _db_upsert(
    hotel_id: str,
    hotel_name: str,
    lat: float | None,
    lng: float | None,
    new_data: dict,
    existing_row: dict | None,
) -> dict:
    """
    Merge new_data with any existing DB row and upsert to hotel_content.
    Returns the full merged result dict.
    """
    existing_photos = list(existing_row.get("photos") or []) if existing_row else []
    existing_reviews = list(existing_row.get("reviews") or []) if existing_row else []

    merged_photos = _merge_photos(existing_photos, new_data.get("photos", []))
    merged_reviews = _merge_reviews(existing_reviews, new_data.get("reviews", []))

    # Prefer new values for aggregate score/count when present
    review_score = new_data.get("review_score") or (existing_row.get("review_score") if existing_row else None)
    review_count = new_data.get("review_count") or (existing_row.get("review_count") if existing_row else None)
    source = new_data.get("source") or (existing_row.get("source") if existing_row else None)

    payload = {
        "hotel_id": hotel_id,
        "hotel_name": hotel_name,
        "lat": lat,
        "lng": lng,
        "photos": merged_photos,
        "reviews": merged_reviews,
        "review_score": review_score,
        "review_count": review_count,
        "source": source,
        "last_enriched_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        db = get_supabase()
        db.table("hotel_content").upsert(payload, on_conflict="hotel_id").execute()
        logger.debug(
            f"hotel_content upserted for {hotel_id}: "
            f"{len(merged_photos)} photos, {len(merged_reviews)} reviews"
        )
    except Exception as exc:
        logger.warning(f"hotel_content DB upsert failed for {hotel_id}: {exc}")
        # Non-fatal — still return the merged data to the caller

    return {
        "photos": merged_photos,
        "reviews": merged_reviews,
        "review_score": review_score,
        "review_count": review_count,
        "source": source,
    }


def _row_to_result(row: dict) -> dict:
    """Convert a Supabase hotel_content row to the enriched result shape."""
    return {
        "photos": list(row.get("photos") or []),
        "reviews": list(row.get("reviews") or []),
        "review_score": row.get("review_score"),
        "review_count": row.get("review_count"),
        "source": row.get("source"),
    }


# ─── Google Places (New API v1) ────────────────────────────────────────────────

_GOOGLE_FIELD_MASK = (
    "id,displayName,rating,userRatingCount,editorialSummary,reviews,photos"
)
_GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
_GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{id}"
_GOOGLE_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{name}/media"


async def _google_fetch_photo_url(
    client: httpx.AsyncClient, photo_name: str, api_key: str
) -> tuple[str, str] | None:
    """Resolve a Google photo resource name to its CDN URI.

    Returns ``(photo_name, photoUri)`` so the caller can store the stable
    resource name alongside the URL for dedup purposes.  Returns ``None`` on
    any error.
    """
    try:
        resp = await client.get(
            _GOOGLE_PHOTO_MEDIA_URL.format(name=photo_name),
            params={"maxHeightPx": 800, "maxWidthPx": 1200, "skipHttpRedirect": "true", "key": api_key},
            timeout=8,
        )
        resp.raise_for_status()
        uri = resp.json().get("photoUri")
        if uri:
            return (photo_name, uri)
        return None
    except Exception as exc:
        logger.debug(f"Google photo fetch failed for {photo_name}: {exc}")
        return None


async def _google_enrich(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    api_key = settings.GOOGLE_PLACES_API_KEY
    if not api_key:
        return _empty()

    async with httpx.AsyncClient() as client:
        # Step 1: Text search
        search_body: dict[str, Any] = {
            "textQuery": f"{hotel_name} hotel",
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
            return _empty()

        place_id = places[0].get("id")
        if not place_id:
            return _empty()

        # Step 2: Place details
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
            logger.warning(f"Google Places detail fetch failed for {place_id}: {exc}")
            return _empty()

        # Step 3: Resolve photo media URLs in parallel.
        # Each result is (resource_name, photoUri) so we can store both:
        #   - "url"  → the CDN URL used by the browser
        #   - "ref"  → the stable Google resource name used for dedup on re-fetch
        photo_resources = place.get("photos", [])[:10]
        photo_tasks = [
            _google_fetch_photo_url(client, p["name"], api_key)
            for p in photo_resources if p.get("name")
        ]
        photo_results = await asyncio.gather(*photo_tasks)
        photos = [
            {"url": uri, "ref": name}
            for result in photo_results
            if result is not None
            for name, uri in (result,)
        ]

        # Step 4: Parse reviews
        reviews: list[dict] = []
        for r in place.get("reviews", []):
            text = (r.get("text") or {}).get("text", "").strip()
            if not text:
                continue
            author = (r.get("authorAttribution") or {}).get("displayName") or "Guest"
            rating_raw = r.get("rating")
            rating = round(float(rating_raw) * 2, 1) if rating_raw is not None else None
            reviews.append({
                "author": author,
                "rating": rating,
                "title": None,
                "text": text,
                "date": r.get("publishTime") or r.get("relativePublishTimeDescription"),
                "source": "google",
            })

        google_rating = place.get("rating")
        return {
            "photos": photos,
            "reviews": reviews,
            "review_score": round(google_rating * 2, 1) if google_rating else None,
            "review_count": place.get("userRatingCount"),
            "source": "google" if (photos or reviews) else None,
        }


# ─── Foursquare Places v3 ─────────────────────────────────────────────────────

_FSQ_SEARCH_URL = "https://api.foursquare.com/v3/places/search"
_FSQ_PHOTOS_URL = "https://api.foursquare.com/v3/places/{fsq_id}/photos"
_FSQ_TIPS_URL = "https://api.foursquare.com/v3/places/{fsq_id}/tips"
_FSQ_HOTEL_CATEGORIES = "19014"


async def _foursquare_enrich(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    api_key = settings.FOURSQUARE_API_KEY
    if not api_key:
        return _empty()

    headers = {"Authorization": api_key, "Accept": "application/json"}

    async with httpx.AsyncClient(headers=headers) as client:
        # Step 1: Search
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
            return _empty()

        venue = results[0]
        fsq_id = venue.get("fsq_id")
        if not fsq_id:
            return _empty()

        # Step 2: Fetch photos and tips in parallel
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
                logger.debug(f"Foursquare photos failed for {fsq_id}: {exc}")
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
                logger.debug(f"Foursquare tips failed for {fsq_id}: {exc}")
                return []

        raw_photos, raw_tips = await asyncio.gather(fetch_photos(), fetch_tips())

        photos = [
            {"url": f"{p['prefix']}original{p['suffix']}"}
            for p in raw_photos
            if p.get("prefix") and p.get("suffix")
        ]

        reviews: list[dict] = []
        for tip in raw_tips:
            text = (tip.get("text") or "").strip()
            if not text:
                continue
            user = tip.get("user") or {}
            first = user.get("firstName") or ""
            last_name = user.get("lastName") or ""
            author = (f"{first} {last_name}").strip() or "Guest"
            reviews.append({
                "author": author,
                "rating": None,
                "title": None,
                "text": text,
                "date": tip.get("created_at"),
                "source": "foursquare",
            })

        fsq_rating = venue.get("rating")  # already 0–10 scale
        return {
            "photos": photos,
            "reviews": reviews,
            "review_score": fsq_rating,
            "review_count": (venue.get("stats") or {}).get("total_tips"),
            "source": "foursquare" if (photos or reviews) else None,
        }


# ─── Internal async orchestrator ─────────────────────────────────────────────

async def _fetch_external(hotel_name: str, lat: float | None, lng: float | None) -> dict:
    """Fetch from Google Places AND Foursquare in parallel and merge results.

    Google Places API caps at 5 reviews per call.  Foursquare tips are a
    complementary source of guest opinions.  By running both concurrently and
    merging the results we can surface up to _MAX_REVIEWS distinct reviews.

    Photos are taken from Google first (they carry a stable ``ref`` for dedup);
    Foursquare photos fill in any remaining slots up to _MAX_PHOTOS.
    """
    google_result, fsq_result = await asyncio.gather(
        _google_enrich(hotel_name, lat, lng),
        _foursquare_enrich(hotel_name, lat, lng),
    )

    # Determine which source wins for metadata (score, count)
    # Prefer Google when it found the place; fall back to Foursquare.
    primary = google_result if google_result["source"] else fsq_result
    secondary = fsq_result if google_result["source"] else google_result

    merged_photos = _merge_photos(primary["photos"], secondary["photos"])
    merged_reviews = _merge_reviews(primary["reviews"], secondary["reviews"])

    source: str | None
    if google_result["source"] and fsq_result["source"]:
        source = "google+foursquare"
    else:
        source = primary["source"]

    return {
        "photos": merged_photos,
        "reviews": merged_reviews,
        "review_score": primary.get("review_score"),
        "review_count": primary.get("review_count"),
        "source": source,
    }


# ─── Public entry-point ───────────────────────────────────────────────────────

async def enrich_hotel(
    hotel_id: str,
    hotel_name: str,
    lat: float | None = None,
    lng: float | None = None,
) -> dict:
    """
    Return enriched hotel content (photos + reviews) for the given hotel.

    Cache hierarchy:
      L1 (in-process, 1 h) → L2 (Supabase hotel_content, 7 days) → external APIs

    When external APIs are called, new photos/reviews are **merged** with the
    existing DB row so the collection grows over time.

    Args:
        hotel_id:   LiteAPI hotel ID — the stable primary key used for DB lookup.
        hotel_name: Human-readable name passed to Google / Foursquare search.
        lat:        Hotel latitude (optional, improves search accuracy).
        lng:        Hotel longitude (optional, improves search accuracy).

    Returns:
        {
          "photos":       list[{"url": str}],
          "reviews":      list[{"author", "rating", "title", "text", "date", "source"}],
          "review_score": float | None,   # 0–10 scale
          "review_count": int | None,
          "source":       "google" | "foursquare" | None,
        }
    """
    if not hotel_id or not hotel_name:
        return _empty()

    # ── L1: in-process ───────────────────────────────────────────────────────
    cached = _l1_get(hotel_id)
    if cached is not None:
        logger.debug(f"hotel_content L1 hit for {hotel_id}")
        return cached

    # ── L2: Supabase ─────────────────────────────────────────────────────────
    db_row = _db_load(hotel_id)
    if db_row and _db_is_fresh(db_row):
        logger.debug(f"hotel_content L2 (DB) hit for {hotel_id}")
        result = _row_to_result(db_row)
        _l1_set(hotel_id, result)
        return result

    # ── External APIs ────────────────────────────────────────────────────────
    logger.debug(f"hotel_content fetching externally for {hotel_id} ('{hotel_name}')")
    try:
        new_data = await _fetch_external(hotel_name, lat, lng)
    except Exception as exc:
        logger.error(f"hotel_content external fetch failed for {hotel_id}: {exc}", exc_info=True)
        new_data = _empty()

    # ── Merge + persist ───────────────────────────────────────────────────────
    result = _db_upsert(hotel_id, hotel_name, lat, lng, new_data, db_row)
    _l1_set(hotel_id, result)
    return result
