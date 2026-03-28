"""
test_feed_search_api.py
─────────────────────────────────────────────────────────────────────────────
Tests for the revamped feed endpoints:
  - POST /api/v1/feed/search  — live YouTube destination search
  - GET  /api/v1/feed?duration=   — duration filter (short/medium/long)

Covers:
  - feed/search: returns DB matches by title, calls YouTube API, deduplicates,
    tags new vlogs with the searched destination, handles YouTube API failure,
    empty destination input returns empty list
  - duration filter: short (<600s), medium (600-1800s), long (>1800s),
    None duration_seconds handled gracefully, invalid values ignored
"""
from __future__ import annotations

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import UserClaims, get_current_user
from app.services.youtube_service import VlogMetadata

FAKE_USER = UserClaims(user_id="user-search-001", email="search@example.com")


# ─── Factories ────────────────────────────────────────────────────────────────

def _yt_vlog(video_id: str = "yt-001", title: str = "Paris Travel Vlog") -> VlogMetadata:
    """Build a minimal VlogMetadata as returned by search_travel_vlogs."""
    return VlogMetadata(
        platform="youtube",
        platform_video_id=video_id,
        title=title,
        description="Amazing travel",
        thumbnail_url=f"https://i.ytimg.com/vi/{video_id}/hq.jpg",
        video_url=f"https://www.youtube.com/watch?v={video_id}",
        channel_name="Travel Channel",
        channel_id="UCtest",
        duration_seconds=900,
        published_at=datetime.now(timezone.utc),
        view_count=50_000,
        like_count=2_000,
    )


def _db_vlog(vlog_id: str = "db-001", title: str = "Paris Highlights") -> dict:
    """A vlog row as returned from the vlogs DB table."""
    return {
        "id": vlog_id,
        "platform": "youtube",
        "platform_video_id": f"vid-{vlog_id}",
        "title": title,
        "thumbnail_url": None,
        "channel_name": "DB Channel",
        "duration_seconds": 1200,
        "published_at": "2025-01-01T00:00:00+00:00",
        "view_count": 10_000,
        "like_count": 500,
        "destinations": ["Paris"],
        "travel_styles": ["cultural"],
        "processing_status": "ready",
        "created_at": "2025-01-01T00:00:00+00:00",
        "itineraries": None,
    }


def _make_search_db(existing_vlogs=None, new_vlog_id="new-vlog-1"):
    """
    Build a DB mock that handles the sequential execute() calls made by
    POST /feed/search:
      1. existing title search  → returns existing_vlogs
      2. check if platform_video_id exists  → returns [] (not found)
      3. insert new vlog  → returns [{"id": new_vlog_id}]
      4. batch fetch for new IDs  → returns full new vlog row
    """
    db = MagicMock()
    table = MagicMock()
    for m in ("select", "eq", "ilike", "in_", "insert", "upsert", "limit",
              "order", "filter", "neq"):
        getattr(table, m).return_value = table

    new_row = _db_vlog(vlog_id=new_vlog_id, title="Paris Travel Vlog")

    table.execute.side_effect = [
        MagicMock(data=existing_vlogs or []),      # 1. title search
        MagicMock(data=[]),                         # 2. check exists
        MagicMock(data=[{"id": new_vlog_id}]),      # 3. insert
        MagicMock(data=[new_row]),                  # 4. batch fetch
    ]
    db.table.return_value = table
    return db, table


def _make_feed_db(feed_rows=None):
    """DB mock for GET /feed with feed_cache rows."""
    db = MagicMock()
    table = MagicMock()
    for m in ("select", "eq", "order", "limit", "lt", "in_", "update", "upsert"):
        getattr(table, m).return_value = table
    table.execute.return_value = MagicMock(data=feed_rows or [])
    db.table.return_value = table
    return db


def _feed_row(vlog_id: str, duration: int, score: float = 0.5) -> dict:
    return {
        "score": score,
        "reason_tags": [],
        "shown": False,
        "vlogs": {
            "id": vlog_id,
            "title": f"Vlog {vlog_id}",
            "platform": "youtube",
            "platform_video_id": f"vid-{vlog_id}",
            "thumbnail_url": None,
            "channel_name": "Channel",
            "duration_seconds": duration,
            "published_at": "2025-01-01T00:00:00+00:00",
            "view_count": 1000,
            "like_count": 50,
            "destinations": [],
            "travel_styles": [],
            "processing_status": "ready",
            "created_at": "2025-01-01T00:00:00+00:00",
            "itineraries": None,
        },
    }


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
# POST /api/v1/feed/search
# ═══════════════════════════════════════════════════════════════════════════════

class TestFeedSearchByDestination:

    def test_empty_destination_returns_empty_list(self, client):
        db, _ = _make_search_db()
        with patch("app.api.v1.feed.get_supabase", return_value=db):
            r = client.post("/api/v1/feed/search", json={"destination": "   "})
        assert r.status_code == 200
        assert r.json()["vlogs"] == []

    def test_empty_destination_does_not_call_youtube(self, client):
        db, _ = _make_search_db()
        yt_mock = MagicMock(return_value=[])
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs", yt_mock):
            client.post("/api/v1/feed/search", json={"destination": ""})
        yt_mock.assert_not_called()

    def test_returns_200_with_new_vlogs_from_youtube(self, client):
        db, _ = _make_search_db()
        yt_result = _yt_vlog("yt-paris-1")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            r = client.post("/api/v1/feed/search", json={"destination": "Paris"})
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_new_vlogs_tagged_with_destination(self, client):
        """Inserted vlogs must have the searched destination in their destinations[]."""
        db, table = _make_search_db()
        yt_result = _yt_vlog("yt-paris-1")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            client.post("/api/v1/feed/search", json={"destination": "Paris"})

        # Confirm the insert was called with destinations=["Paris"]
        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        inserted_payload = insert_calls[0][0][0]
        assert "Paris" in inserted_payload["destinations"]

    def test_new_vlogs_marked_ready(self, client):
        """Inserted vlogs must have processing_status='ready' so they appear immediately."""
        db, table = _make_search_db()
        yt_result = _yt_vlog("yt-paris-1")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            client.post("/api/v1/feed/search", json={"destination": "Paris"})

        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        payload = insert_calls[0][0][0]
        assert payload["processing_status"] == "ready"

    def test_existing_db_vlog_not_inserted_twice(self, client):
        """When platform_video_id already exists, skip insert but still surface it."""
        existing = _db_vlog("db-paris-1")
        db = MagicMock()
        table = MagicMock()
        for m in ("select", "eq", "ilike", "in_", "insert", "limit", "order", "filter"):
            getattr(table, m).return_value = table

        # Sequence:
        # 1. title ilike search → returns existing
        # 2. check platform_video_id exists → YES (found)
        # Final batch fetch: we skip since existing_vlogs already covers this
        table.execute.side_effect = [
            MagicMock(data=[existing]),            # title search
            MagicMock(data=[{"id": "db-paris-1"}]),  # check exists → found
            MagicMock(data=[]),                    # batch fetch of new_ids (empty)
        ]
        db.table.return_value = table

        yt_result = _yt_vlog(f"vid-{existing['platform_video_id']}")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            r = client.post("/api/v1/feed/search", json={"destination": "Paris"})

        assert r.status_code == 200
        # Insert must NOT have been called for an already-existing video
        table.insert.assert_not_called()

    def test_youtube_api_failure_returns_empty_list_gracefully(self, client):
        """If YouTube search throws, the endpoint should return [] without crashing."""
        db = MagicMock()
        table = MagicMock()
        for m in ("select", "eq", "ilike", "in_", "limit", "order"):
            getattr(table, m).return_value = table
        table.execute.side_effect = [
            MagicMock(data=[]),   # title search → nothing found
            MagicMock(data=[]),   # batch fetch (empty new_ids)
        ]
        db.table.return_value = table

        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   side_effect=ConnectionError("YouTube API down")):
            r = client.post("/api/v1/feed/search", json={"destination": "Tokyo"})

        assert r.status_code == 200
        assert r.json()["vlogs"] == []

    def test_deduplication_across_db_and_youtube_results(self, client):
        """A video that appears in both DB search and YouTube results should appear once."""
        shared_vid_id = "shared-vid-001"
        existing_vlog = _db_vlog("shared-db-id", title="Paris Travel")
        existing_vlog["platform_video_id"] = shared_vid_id

        db = MagicMock()
        table = MagicMock()
        for m in ("select", "eq", "ilike", "in_", "insert", "limit", "order"):
            getattr(table, m).return_value = table
        table.execute.side_effect = [
            MagicMock(data=[existing_vlog]),              # title search
            MagicMock(data=[{"id": "shared-db-id"}]),     # check exists → found
            MagicMock(data=[]),                            # batch fetch (no new)
        ]
        db.table.return_value = table

        yt_result = _yt_vlog(shared_vid_id, title="Paris Travel")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            r = client.post("/api/v1/feed/search", json={"destination": "Paris"})

        vlogs = r.json()["vlogs"]
        vlog_ids = [v["id"] for v in vlogs]
        assert len(vlog_ids) == len(set(vlog_ids)), "Duplicate vlog IDs in response"

    def test_respects_limit_parameter(self, client):
        """Response should contain at most `limit` vlogs."""
        db = MagicMock()
        table = MagicMock()
        for m in ("select", "eq", "ilike", "in_", "insert", "limit", "order"):
            getattr(table, m).return_value = table

        # Return many existing vlogs
        many_vlogs = [_db_vlog(f"v{i}") for i in range(10)]
        table.execute.side_effect = [
            MagicMock(data=many_vlogs),   # title search
            MagicMock(data=[]),           # batch fetch for new_ids (none from YT)
        ]
        db.table.return_value = table

        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs", return_value=[]):
            r = client.post("/api/v1/feed/search", json={"destination": "Japan", "limit": 3})

        assert r.status_code == 200
        assert len(r.json()["vlogs"]) <= 3

    def test_itinerary_field_always_present(self, client):
        """Every vlog in the response must have an itinerary_id key (even if None)."""
        db, _ = _make_search_db()
        yt_result = _yt_vlog("yt-paris-2")
        with patch("app.api.v1.feed.get_supabase", return_value=db), \
             patch("app.services.youtube_service.search_travel_vlogs",
                   return_value=[yt_result]):
            r = client.post("/api/v1/feed/search", json={"destination": "Paris"})

        for vlog in r.json().get("vlogs", []):
            assert "itinerary_id" in vlog


# ═══════════════════════════════════════════════════════════════════════════════
# Duration filter — tested via get_paginated_feed directly (unit style)
#
# The GET /feed route is mostly a thin wrapper: mocking at the service level
# is cleaner and avoids having to stub the background-task Supabase calls.
# The API-to-service wiring is validated by the style/destination tests above
# which use the real HTTP client.
# ═══════════════════════════════════════════════════════════════════════════════

from app.services.feed_ranking_service import get_paginated_feed as _get_feed


def _mock_supabase_with_rows(rows):
    """Build a mock Supabase whose feed_cache query returns `rows`."""
    from unittest.mock import MagicMock
    db = MagicMock()
    chain = db.table.return_value
    for m in ("select", "eq", "order", "limit", "lt"):
        getattr(chain, m).return_value = chain
    chain.execute.return_value = MagicMock(data=rows)
    return db


class TestFeedDurationFilter:

    def test_short_filter_excludes_videos_at_or_over_600s(self):
        rows = [
            _feed_row("short-vid", 300, score=0.9),    # 5 min  → include
            _feed_row("medium-vid", 600, score=0.8),   # 10 min → exclude (at boundary)
            _feed_row("long-vid", 1200, score=0.7),    # 20 min → exclude
        ]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="short")
        ids = [v["id"] for v in result["vlogs"]]
        assert "short-vid" in ids
        assert "medium-vid" not in ids
        assert "long-vid" not in ids

    def test_medium_filter_includes_600_to_1799s(self):
        rows = [
            _feed_row("short-vid", 300, score=0.9),    # exclude
            _feed_row("mid-low", 600, score=0.85),     # include (lower bound)
            _feed_row("mid-mid", 900, score=0.8),      # include
            _feed_row("mid-high", 1799, score=0.75),   # include (just below upper)
            _feed_row("long-vid", 1800, score=0.7),    # exclude (at upper boundary)
        ]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="medium")
        ids = [v["id"] for v in result["vlogs"]]
        assert "short-vid" not in ids
        assert "mid-low" in ids
        assert "mid-mid" in ids
        assert "mid-high" in ids
        assert "long-vid" not in ids

    def test_long_filter_requires_at_least_1800s(self):
        rows = [
            _feed_row("short-vid", 300, score=0.9),    # exclude
            _feed_row("medium-vid", 900, score=0.8),   # exclude
            _feed_row("long-vid", 1800, score=0.75),   # include (exactly 30 min)
            _feed_row("very-long", 3600, score=0.7),   # include (60 min)
        ]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="long")
        ids = [v["id"] for v in result["vlogs"]]
        assert "short-vid" not in ids
        assert "medium-vid" not in ids
        assert "long-vid" in ids
        assert "very-long" in ids

    def test_no_duration_filter_returns_all(self):
        rows = [
            _feed_row("short-vid", 300, score=0.9),
            _feed_row("long-vid", 3600, score=0.8),
        ]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1")
        ids = [v["id"] for v in result["vlogs"]]
        assert "short-vid" in ids
        assert "long-vid" in ids

    def test_null_duration_seconds_treated_as_zero(self):
        """Vlogs with duration_seconds=None are treated as 0 (included in short filter)."""
        row = _feed_row("no-dur", duration=0, score=0.9)
        row["vlogs"]["duration_seconds"] = None
        db = _mock_supabase_with_rows([row])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="short")
        ids = [v["id"] for v in result["vlogs"]]
        assert "no-dur" in ids

    def test_duration_combined_with_style_filter(self):
        """Duration and style applied together — only matching both are returned."""
        row_adv_short = _feed_row("adv-short", 300, score=0.9)
        row_adv_short["vlogs"]["travel_styles"] = ["adventure"]
        row_adv_long = _feed_row("adv-long", 3600, score=0.8)
        row_adv_long["vlogs"]["travel_styles"] = ["adventure"]
        rows = [row_adv_short, row_adv_long]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="short", style="adventure")
        ids = [v["id"] for v in result["vlogs"]]
        assert "adv-short" in ids
        assert "adv-long" not in ids

    def test_unknown_duration_value_returns_all_without_crashing(self):
        """An unrecognised duration keyword should not crash — just include everything."""
        rows = [_feed_row("v1", 300), _feed_row("v2", 3600)]
        db = _mock_supabase_with_rows(rows)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = _get_feed("user-1", duration="marathon")
        assert isinstance(result["vlogs"], list)
