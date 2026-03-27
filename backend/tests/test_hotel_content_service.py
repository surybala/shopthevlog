"""
Tests for app.services.hotel_content_service
─────────────────────────────────────────────
All external I/O (Supabase, httpx) is fully mocked — no real network calls.

Coverage:
  - _merge_photos       : URL dedup (Foursquare/LiteAPI), ref dedup (Google),
                          mixed sources, MAX_PHOTOS cap, empty-URL skip
  - _merge_reviews      : text dedup, empty-text skip, MAX_REVIEWS cap
  - _db_is_fresh        : ISO string parsing, Z-suffix, TTL boundary, invalid value
  - _row_to_result      : field mapping, missing-field defaults
  - L1 cache            : set/get, TTL expiry, eviction
  - _google_fetch_photo_url : success, missing photoUri, HTTP error
  - _google_enrich      : no API key, empty search, search failure, happy path
                          (photos carry ref, reviews carry source), failed photo skip
  - _foursquare_enrich  : no API key, empty search, happy path (no ref on photos)
  - _fetch_external     : Google-first, Foursquare fallback
  - enrich_hotel        : blank args, L1 hit, L2 fresh hit, stale hit, DB miss,
                          external failure non-fatal
  - _db_upsert          : photo merge, ref-based dedup on re-upsert, review merge,
                          DB failure non-fatal, score preference
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.hotel_content_service as svc
from app.services.hotel_content_service import (
    _db_is_fresh,
    _empty,
    _l1_get,
    _l1_set,
    _merge_photos,
    _merge_reviews,
    _row_to_result,
    enrich_hotel,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clear_l1_cache():
    """Wipe the in-process cache before and after every test."""
    with svc._cache_lock:
        svc._cache.clear()
    yield
    with svc._cache_lock:
        svc._cache.clear()


def _mock_response(json_data: dict | list, status_code: int = 200) -> MagicMock:
    """Build a fake httpx response that returns json_data from .json()."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    else:
        resp.raise_for_status = MagicMock()
    return resp


def _async_client_ctx(mock_client: AsyncMock):
    """Wrap a mock AsyncClient instance in a context-manager mock."""
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


# ═══════════════════════════════════════════════════════════════════════════════
# _merge_photos
# ═══════════════════════════════════════════════════════════════════════════════

class TestMergePhotos:
    def test_empty_existing_and_new_returns_empty(self):
        assert _merge_photos([], []) == []

    def test_new_photos_added_when_existing_is_empty(self):
        new = [{"url": "https://a.com/1.jpg"}, {"url": "https://a.com/2.jpg"}]
        assert len(_merge_photos([], new)) == 2

    # ── URL-based dedup (Foursquare / LiteAPI — no ref) ───────────────────────

    def test_same_url_not_added_twice(self):
        existing = [{"url": "https://a.com/1.jpg"}]
        new = [{"url": "https://a.com/1.jpg"}]
        assert len(_merge_photos(existing, new)) == 1

    def test_different_url_is_added_when_no_ref(self):
        existing = [{"url": "https://a.com/1.jpg"}]
        new = [{"url": "https://a.com/2.jpg"}]
        assert len(_merge_photos(existing, new)) == 2

    # ── Ref-based dedup (Google — URL can change between calls) ───────────────

    def test_same_ref_different_url_not_added(self):
        """If the Google photo ref matches, it's a duplicate even if CDN URL rotated."""
        existing = [{"url": "https://lh3.goo.gl/OLD_TOKEN", "ref": "places/X/photos/P1"}]
        new = [{"url": "https://lh3.goo.gl/NEW_TOKEN", "ref": "places/X/photos/P1"}]
        result = _merge_photos(existing, new)
        assert len(result) == 1
        assert result[0]["url"] == "https://lh3.goo.gl/OLD_TOKEN"  # original preserved

    def test_new_google_photo_with_different_ref_is_added(self):
        existing = [{"url": "https://lh3.goo.gl/A", "ref": "places/X/photos/P1"}]
        new = [{"url": "https://lh3.goo.gl/B", "ref": "places/X/photos/P2"}]
        assert len(_merge_photos(existing, new)) == 2

    # ── Mixed sources ─────────────────────────────────────────────────────────

    def test_ref_photo_and_url_only_photo_coexist(self):
        """A Foursquare URL-only photo and a Google ref photo don't block each other."""
        existing = [{"url": "https://fsq.com/photo1.jpg"}]
        new = [{"url": "https://lh3.goo.gl/A", "ref": "places/X/photos/P1"}]
        assert len(_merge_photos(existing, new)) == 2

    def test_url_only_photo_not_blocked_by_existing_ref_photo(self):
        """A new Foursquare photo (no ref) is added even when existing rows have refs."""
        existing = [{"url": "https://lh3.goo.gl/A", "ref": "places/X/photos/P1"}]
        new = [{"url": "https://fsq.com/photo2.jpg"}]
        assert len(_merge_photos(existing, new)) == 2

    # ── Cap & edge cases ──────────────────────────────────────────────────────

    def test_capped_at_max_photos(self):
        existing = [{"url": f"https://a.com/{i}.jpg"} for i in range(svc._MAX_PHOTOS)]
        new = [{"url": "https://a.com/extra.jpg"}]
        assert len(_merge_photos(existing, new)) == svc._MAX_PHOTOS

    def test_photo_with_empty_url_and_no_ref_is_skipped(self):
        assert _merge_photos([], [{"url": ""}, {"url": "https://good.com/a.jpg"}]) == [{"url": "https://good.com/a.jpg"}]


# ═══════════════════════════════════════════════════════════════════════════════
# _merge_reviews
# ═══════════════════════════════════════════════════════════════════════════════

class TestMergeReviews:
    def test_empty_returns_empty(self):
        assert _merge_reviews([], []) == []

    def test_new_reviews_added_to_empty_existing(self):
        assert len(_merge_reviews([], [{"text": "Great stay!"}])) == 1

    def test_exact_text_duplicate_not_added(self):
        existing = [{"text": "Great stay!"}]
        new = [{"text": "Great stay!"}]
        assert len(_merge_reviews(existing, new)) == 1

    def test_different_text_added(self):
        existing = [{"text": "Great stay!"}]
        new = [{"text": "Loved the view."}]
        assert len(_merge_reviews(existing, new)) == 2

    def test_review_with_empty_text_skipped(self):
        assert _merge_reviews([], [{"text": ""}, {"author": "Bob"}]) == []

    def test_capped_at_max_reviews(self):
        existing = [{"text": f"Review {i}"} for i in range(svc._MAX_REVIEWS)]
        assert len(_merge_reviews(existing, [{"text": "One more"}])) == svc._MAX_REVIEWS


# ═══════════════════════════════════════════════════════════════════════════════
# _db_is_fresh
# ═══════════════════════════════════════════════════════════════════════════════

class TestDbIsFresh:
    def test_none_last_enriched_is_not_fresh(self):
        assert _db_is_fresh({"last_enriched_at": None}) is False

    def test_missing_last_enriched_is_not_fresh(self):
        assert _db_is_fresh({}) is False

    def test_recent_iso_string_is_fresh(self):
        one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert _db_is_fresh({"last_enriched_at": one_hour_ago}) is True

    def test_old_iso_string_is_stale(self):
        eight_days_ago = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        assert _db_is_fresh({"last_enriched_at": eight_days_ago}) is False

    def test_exactly_at_ttl_is_stale(self):
        at_ttl = (datetime.now(timezone.utc) - timedelta(days=svc._L2_TTL_DAYS)).isoformat()
        assert _db_is_fresh({"last_enriched_at": at_ttl}) is False

    def test_z_suffix_iso_string_is_parsed(self):
        """Supabase returns timestamps with a trailing 'Z' — must parse correctly."""
        recent = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime(
            "%Y-%m-%dT%H:%M:%S.%f"
        ) + "Z"
        assert _db_is_fresh({"last_enriched_at": recent}) is True

    def test_invalid_value_returns_false(self):
        assert _db_is_fresh({"last_enriched_at": "not-a-date"}) is False


# ═══════════════════════════════════════════════════════════════════════════════
# _row_to_result
# ═══════════════════════════════════════════════════════════════════════════════

class TestRowToResult:
    def test_converts_all_fields(self):
        row = {
            "photos": [{"url": "https://a.com/1.jpg", "ref": "places/X/photos/P1"}],
            "reviews": [{"text": "Great", "author": "Alice"}],
            "review_score": 8.4,
            "review_count": 200,
            "source": "google",
        }
        result = _row_to_result(row)
        assert result["photos"] == row["photos"]
        assert result["reviews"] == row["reviews"]
        assert result["review_score"] == 8.4
        assert result["review_count"] == 200
        assert result["source"] == "google"

    def test_missing_fields_default_to_none_or_empty(self):
        result = _row_to_result({})
        assert result["photos"] == []
        assert result["reviews"] == []
        assert result["review_score"] is None
        assert result["review_count"] is None
        assert result["source"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# L1 in-process cache
# ═══════════════════════════════════════════════════════════════════════════════

class TestL1Cache:
    def test_set_then_get_returns_data(self):
        data = {**_empty(), "source": "google"}
        _l1_set("hotel_abc", data)
        assert _l1_get("hotel_abc") == data

    def test_missing_key_returns_none(self):
        assert _l1_get("nonexistent_hotel") is None

    def test_expired_entry_returns_none_and_is_evicted(self):
        data = _empty()
        with svc._cache_lock:
            svc._cache["hotel_expired"] = (data, time.time() - svc._L1_TTL - 1)
        assert _l1_get("hotel_expired") is None
        with svc._cache_lock:
            assert "hotel_expired" not in svc._cache


# ═══════════════════════════════════════════════════════════════════════════════
# _google_fetch_photo_url  (async)
# ═══════════════════════════════════════════════════════════════════════════════

class TestGoogleFetchPhotoUrl:
    def test_returns_name_and_uri_on_success(self):
        resp = _mock_response({"photoUri": "https://lh3.goo.gl/abc"})
        client = AsyncMock()
        client.get.return_value = resp
        result = asyncio.run(svc._google_fetch_photo_url(client, "places/X/photos/P1", "key"))
        assert result == ("places/X/photos/P1", "https://lh3.goo.gl/abc")

    def test_returns_none_when_photo_uri_missing(self):
        resp = _mock_response({})  # no photoUri key
        client = AsyncMock()
        client.get.return_value = resp
        result = asyncio.run(svc._google_fetch_photo_url(client, "places/X/photos/P1", "key"))
        assert result is None

    def test_returns_none_on_http_error(self):
        client = AsyncMock()
        client.get.side_effect = Exception("Connection refused")
        result = asyncio.run(svc._google_fetch_photo_url(client, "places/X/photos/P1", "key"))
        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# _google_enrich  (async)
# ═══════════════════════════════════════════════════════════════════════════════

class TestGoogleEnrich:
    def test_returns_empty_when_no_api_key(self):
        with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", ""):
            result = asyncio.run(svc._google_enrich("Test Hotel", 35.0, 139.0))
        assert result == _empty()

    def test_returns_empty_when_text_search_finds_nothing(self):
        mock_client = AsyncMock()
        mock_client.post.return_value = _mock_response({"places": []})
        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", "key"):
                result = asyncio.run(svc._google_enrich("Unknown Hotel", None, None))
        assert result == _empty()

    def test_returns_empty_on_text_search_failure(self):
        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("Network error")
        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", "key"):
                result = asyncio.run(svc._google_enrich("Test Hotel", None, None))
        assert result == _empty()

    def test_returns_empty_on_place_details_failure(self):
        mock_client = AsyncMock()
        mock_client.post.return_value = _mock_response({"places": [{"id": "ChIJ_x"}]})
        mock_client.get.side_effect = Exception("Details fetch failed")
        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", "key"):
                result = asyncio.run(svc._google_enrich("Test Hotel", None, None))
        assert result == _empty()

    def test_happy_path_photos_carry_ref_and_reviews_carry_source(self):
        mock_client = AsyncMock()
        mock_client.post.return_value = _mock_response({"places": [{"id": "ChIJ_test"}]})

        detail_resp = _mock_response({
            "rating": 4.5,
            "userRatingCount": 250,
            "photos": [{"name": "places/ChIJ_test/photos/PHOTO1"}],
            "reviews": [{
                "text": {"text": "Excellent hotel, great service."},
                "rating": 5,
                "authorAttribution": {"displayName": "Alice"},
                "publishTime": "2024-01-15T10:00:00Z",
            }],
        })
        photo_media_resp = _mock_response({"photoUri": "https://lh3.goo.gl/CDN_URL"})
        mock_client.get.side_effect = [detail_resp, photo_media_resp]

        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", "key"):
                result = asyncio.run(svc._google_enrich("Keio Plaza Hotel", 35.69, 139.69))

        assert result["source"] == "google"
        assert len(result["photos"]) == 1
        assert result["photos"][0]["url"] == "https://lh3.goo.gl/CDN_URL"
        assert result["photos"][0]["ref"] == "places/ChIJ_test/photos/PHOTO1"
        assert len(result["reviews"]) == 1
        assert result["reviews"][0]["author"] == "Alice"
        assert result["reviews"][0]["rating"] == 10.0   # 5 * 2
        assert result["reviews"][0]["source"] == "google"
        assert result["review_score"] == 9.0            # 4.5 * 2
        assert result["review_count"] == 250

    def test_failed_photo_media_fetch_is_excluded(self):
        """A photo whose media URL fetch fails is omitted; others are included."""
        mock_client = AsyncMock()
        mock_client.post.return_value = _mock_response({"places": [{"id": "ChIJ_test"}]})

        detail_resp = _mock_response({
            "photos": [
                {"name": "places/ChIJ_test/photos/GOOD"},
                {"name": "places/ChIJ_test/photos/BAD"},
            ],
            "reviews": [],
        })
        good_resp = _mock_response({"photoUri": "https://lh3.goo.gl/GOOD_URL"})

        async def get_side_effect(url, **kwargs):
            if "GOOD" in url:
                return good_resp
            if "BAD" in url:
                raise Exception("CDN timeout")
            return detail_resp

        mock_client.get.side_effect = get_side_effect

        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "GOOGLE_PLACES_API_KEY", "key"):
                result = asyncio.run(svc._google_enrich("Test Hotel", None, None))

        photo_refs = [p.get("ref") for p in result["photos"]]
        assert "places/ChIJ_test/photos/GOOD" in photo_refs
        assert "places/ChIJ_test/photos/BAD" not in photo_refs


# ═══════════════════════════════════════════════════════════════════════════════
# _foursquare_enrich  (async)
# ═══════════════════════════════════════════════════════════════════════════════

class TestFoursquareEnrich:
    def test_returns_empty_when_no_api_key(self):
        with patch.object(svc.settings, "FOURSQUARE_API_KEY", ""):
            result = asyncio.run(svc._foursquare_enrich("Test Hotel", 35.0, 139.0))
        assert result == _empty()

    def test_returns_empty_when_search_finds_nothing(self):
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response({"results": []})
        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "FOURSQUARE_API_KEY", "key"):
                result = asyncio.run(svc._foursquare_enrich("Unknown Hotel", None, None))
        assert result == _empty()

    def test_happy_path_photos_have_no_ref(self):
        """Foursquare photos use stable CDN URLs — no ref field needed."""
        search_resp = _mock_response({
            "results": [{"fsq_id": "fsq_abc", "rating": 8.5, "stats": {"total_tips": 42}}]
        })
        photos_resp = _mock_response([
            {"prefix": "https://fastly.4sqi.net/img/general/", "suffix": "/12345_abc.jpg"},
        ])
        tips_resp = _mock_response([
            {
                "text": "Best hotel in Shinjuku, great value.",
                "created_at": "2024-02-10T08:00:00Z",
                "user": {"firstName": "Bob", "lastName": "Smith"},
            }
        ])

        mock_client = AsyncMock()
        mock_client.get.side_effect = [search_resp, photos_resp, tips_resp]

        with patch("app.services.hotel_content_service.httpx.AsyncClient",
                   return_value=_async_client_ctx(mock_client)):
            with patch.object(svc.settings, "FOURSQUARE_API_KEY", "key"):
                result = asyncio.run(svc._foursquare_enrich("Keio Plaza Hotel", 35.69, 139.69))

        assert result["source"] == "foursquare"
        assert len(result["photos"]) == 1
        assert "ref" not in result["photos"][0]
        assert result["photos"][0]["url"] == (
            "https://fastly.4sqi.net/img/general/original/12345_abc.jpg"
        )
        assert len(result["reviews"]) == 1
        assert result["reviews"][0]["author"] == "Bob Smith"
        assert result["reviews"][0]["source"] == "foursquare"
        assert result["review_score"] == 8.5
        assert result["review_count"] == 42


# ═══════════════════════════════════════════════════════════════════════════════
# _fetch_external — Google-first with Foursquare fallback
# ═══════════════════════════════════════════════════════════════════════════════

class TestFetchExternal:
    async def test_uses_google_result_when_google_succeeds(self):
        google_result = {**_empty(), "source": "google",
                         "photos": [{"url": "https://g.co/p.jpg", "ref": "ref/1"}]}
        fsq_result = {**_empty(), "source": "foursquare"}

        with patch.object(svc, "_google_enrich", new=AsyncMock(return_value=google_result)) as mock_g, \
             patch.object(svc, "_foursquare_enrich", new=AsyncMock(return_value=fsq_result)) as mock_f:
            result = await svc._fetch_external("Hotel X", 35.0, 139.0)

        assert result["source"] == "google"
        mock_f.assert_not_awaited()

    async def test_falls_back_to_foursquare_when_google_yields_nothing(self):
        google_empty = _empty()  # source is None
        fsq_result = {**_empty(), "source": "foursquare",
                      "photos": [{"url": "https://fsq.com/p.jpg"}]}

        with patch.object(svc, "_google_enrich", new=AsyncMock(return_value=google_empty)), \
             patch.object(svc, "_foursquare_enrich", new=AsyncMock(return_value=fsq_result)):
            result = await svc._fetch_external("Hotel X", 35.0, 139.0)

        assert result["source"] == "foursquare"


# ═══════════════════════════════════════════════════════════════════════════════
# enrich_hotel — public entry point
# ═══════════════════════════════════════════════════════════════════════════════

class TestEnrichHotel:
    async def test_returns_empty_for_blank_hotel_id(self):
        assert await enrich_hotel("", "Test Hotel") == _empty()

    async def test_returns_empty_for_blank_hotel_name(self):
        assert await enrich_hotel("hotel_123", "") == _empty()

    async def test_l1_cache_hit_skips_db_and_external(self):
        cached = {**_empty(), "source": "google",
                  "photos": [{"url": "https://cdn.test/1.jpg", "ref": "ref/p1"}]}
        _l1_set("hotel_123", cached)

        with patch.object(svc, "_db_load") as mock_db, \
             patch.object(svc, "_fetch_external", new=AsyncMock()) as mock_ext:
            result = await enrich_hotel("hotel_123", "Test Hotel")

        assert result == cached
        mock_db.assert_not_called()
        mock_ext.assert_not_awaited()

    async def test_l2_fresh_hit_populates_l1_and_skips_external(self):
        db_row = {
            "hotel_id": "hotel_456",
            "photos": [{"url": "https://cdn.test/2.jpg", "ref": "ref/p2"}],
            "reviews": [{"text": "Good hotel.", "author": "Bob"}],
            "review_score": 8.0,
            "review_count": 100,
            "source": "google",
            "last_enriched_at": datetime.now(timezone.utc).isoformat(),
        }

        with patch.object(svc, "_db_load", return_value=db_row), \
             patch.object(svc, "_db_is_fresh", return_value=True), \
             patch.object(svc, "_fetch_external", new=AsyncMock()) as mock_ext:
            result = await enrich_hotel("hotel_456", "Hotel Y")

        assert result["source"] == "google"
        assert len(result["photos"]) == 1
        mock_ext.assert_not_awaited()
        # L1 now populated
        assert _l1_get("hotel_456") is not None

    async def test_stale_db_row_triggers_external_fetch_and_upsert(self):
        stale_row = {
            "hotel_id": "hotel_789",
            "photos": [{"url": "https://fsq.com/old.jpg"}],
            "reviews": [],
            "review_score": None,
            "review_count": None,
            "source": "foursquare",
            "last_enriched_at": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
        }
        new_data = {
            "photos": [{"url": "https://lh3.goo.gl/new.jpg", "ref": "places/X/photos/P1"}],
            "reviews": [{"text": "Wonderful stay.", "author": "Alice"}],
            "review_score": 9.0,
            "review_count": 300,
            "source": "google",
        }

        with patch.object(svc, "_db_load", return_value=stale_row), \
             patch.object(svc, "_db_is_fresh", return_value=False), \
             patch.object(svc, "_fetch_external", new=AsyncMock(return_value=new_data)), \
             patch.object(svc, "_db_upsert", return_value=new_data) as mock_upsert:
            result = await enrich_hotel("hotel_789", "Hotel Z", lat=35.0, lng=139.0)

        mock_upsert.assert_called_once()
        assert result["source"] == "google"

    async def test_missing_db_row_triggers_external_fetch_with_none_existing(self):
        new_data = {
            "photos": [{"url": "https://lh3.goo.gl/A.jpg", "ref": "places/X/photos/PA"}],
            "reviews": [],
            "review_score": 7.5,
            "review_count": 50,
            "source": "google",
        }

        with patch.object(svc, "_db_load", return_value=None), \
             patch.object(svc, "_fetch_external", new=AsyncMock(return_value=new_data)), \
             patch.object(svc, "_db_upsert", return_value=new_data) as mock_upsert:
            result = await enrich_hotel("hotel_new", "Brand New Hotel")

        mock_upsert.assert_called_once_with("hotel_new", "Brand New Hotel", None, None, new_data, None)
        assert result["source"] == "google"

    async def test_external_api_failure_is_non_fatal_and_upserts_empty(self):
        with patch.object(svc, "_db_load", return_value=None), \
             patch.object(svc, "_fetch_external", new=AsyncMock(side_effect=Exception("API down"))), \
             patch.object(svc, "_db_upsert", return_value=_empty()) as mock_upsert:
            result = await enrich_hotel("hotel_fail", "Failing Hotel")

        # Still calls upsert (with empty data) — non-fatal
        mock_upsert.assert_called_once()
        assert result == _empty()


# ═══════════════════════════════════════════════════════════════════════════════
# _db_upsert — merge logic and persistence
# ═══════════════════════════════════════════════════════════════════════════════

class TestDbUpsert:
    def test_merges_existing_and_new_photos(self, mock_supabase):
        existing_row = {
            "photos": [{"url": "https://old.com/1.jpg"}],
            "reviews": [], "review_score": None, "review_count": None, "source": None,
        }
        new_data = {
            "photos": [{"url": "https://new.com/2.jpg", "ref": "places/X/photos/P2"}],
            "reviews": [], "review_score": None, "review_count": None, "source": "google",
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h1", "Hotel One", 35.0, 139.0, new_data, existing_row)
        assert len(result["photos"]) == 2

    def test_same_google_ref_on_re_upsert_is_not_duplicated(self, mock_supabase):
        """When the same photo resource ref comes in on a re-fetch, only one copy is kept."""
        existing_row = {
            "photos": [{"url": "https://lh3.goo.gl/OLD", "ref": "places/X/photos/P1"}],
            "reviews": [], "review_score": 8.0, "review_count": 50, "source": "google",
        }
        new_data = {
            "photos": [{"url": "https://lh3.goo.gl/NEW", "ref": "places/X/photos/P1"}],
            "reviews": [], "review_score": 8.2, "review_count": 55, "source": "google",
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h1", "Hotel One", 35.0, 139.0, new_data, existing_row)
        assert len(result["photos"]) == 1
        assert result["review_score"] == 8.2  # score updated

    def test_merges_reviews_from_existing_and_new(self, mock_supabase):
        existing_row = {
            "photos": [], "reviews": [{"text": "Old review from last month."}],
            "review_score": None, "review_count": None, "source": None,
        }
        new_data = {
            "photos": [], "reviews": [{"text": "New review this week."}],
            "review_score": None, "review_count": None, "source": "google",
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h2", "Hotel Two", None, None, new_data, existing_row)
        assert len(result["reviews"]) == 2

    def test_db_failure_is_non_fatal_and_returns_merged_data(self, mock_supabase):
        """Even when Supabase throws, the merged result is still returned to the caller."""
        mock_supabase.table.side_effect = Exception("DB connection refused")
        new_data = {
            "photos": [{"url": "https://a.com/p.jpg"}],
            "reviews": [], "review_score": None, "review_count": None, "source": "google",
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h3", "Hotel Three", None, None, new_data, None)
        assert len(result["photos"]) == 1
        assert result["source"] == "google"

    def test_prefers_new_review_score_over_existing(self, mock_supabase):
        existing_row = {
            "photos": [], "reviews": [],
            "review_score": 7.5, "review_count": 100, "source": "foursquare",
        }
        new_data = {
            "photos": [], "reviews": [],
            "review_score": 8.8, "review_count": 200, "source": "google",
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h4", "Hotel Four", None, None, new_data, existing_row)
        assert result["review_score"] == 8.8
        assert result["review_count"] == 200

    def test_falls_back_to_existing_score_when_new_has_none(self, mock_supabase):
        existing_row = {
            "photos": [], "reviews": [],
            "review_score": 7.5, "review_count": 100, "source": "foursquare",
        }
        new_data = {
            "photos": [], "reviews": [],
            "review_score": None, "review_count": None, "source": None,
        }
        with patch("app.services.hotel_content_service.get_supabase", return_value=mock_supabase):
            result = svc._db_upsert("h5", "Hotel Five", None, None, new_data, existing_row)
        assert result["review_score"] == 7.5
        assert result["review_count"] == 100
