"""
Tests for app.services.feed_ranking_service — scoring helpers, feed builders,
and query functions.  All Supabase calls are mocked.
"""
import math
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch, call


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_db(table_data: dict | None = None):
    """
    Return a mock Supabase client where each table returns configurable data.

    table_data maps table_name → list of row dicts returned by .execute().
    Any table not listed returns an empty list.
    """
    table_data = table_data or {}

    class _Chain:
        def __init__(self, data=None):
            self._data = data or []

        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def in_(self, *a, **kw): return self
        def gte(self, *a, **kw): return self
        def lt(self, *a, **kw): return self
        def lte(self, *a, **kw): return self
        def order(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def upsert(self, *a, **kw): return self
        def update(self, *a, **kw): return self
        def insert(self, *a, **kw): return self
        def ilike(self, *a, **kw): return self
        def execute(self):
            result = MagicMock()
            result.data = self._data
            return result

    class _Table:
        def __init__(self, data):
            self._data = data

        def select(self, *a, **kw):
            return _Chain(self._data)

        def upsert(self, rows, *a, **kw):
            chain = _Chain([])
            return chain

        def update(self, *a, **kw):
            return _Chain([])

        def insert(self, *a, **kw):
            return _Chain([])

    db = MagicMock()
    db.table = lambda name: _Table(table_data.get(name, []))
    return db


# ─────────────────────────────────────────────────────────────────────────────
# _overlap_score
# ─────────────────────────────────────────────────────────────────────────────

class TestOverlapScore:
    def test_empty_a_returns_zero(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score([], ["japan"]) == 0.0

    def test_empty_b_returns_zero(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score(["japan"], []) == 0.0

    def test_both_empty_returns_zero(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score([], []) == 0.0

    def test_full_overlap_returns_one(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score(["japan", "tokyo"], ["japan", "tokyo"]) == 1.0

    def test_no_overlap_returns_zero(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score(["japan"], ["france"]) == 0.0

    def test_partial_overlap(self):
        from app.services.feed_ranking_service import _overlap_score
        # intersection={japan}, max_len=2
        score = _overlap_score(["japan", "tokyo"], ["japan", "paris"])
        assert score == pytest.approx(0.5)

    def test_case_insensitive(self):
        from app.services.feed_ranking_service import _overlap_score
        assert _overlap_score(["Japan"], ["japan"]) == 1.0

    def test_asymmetric_sizes(self):
        from app.services.feed_ranking_service import _overlap_score
        # a={japan,tokyo,osaka}, b={japan} → intersection=1, max=3
        score = _overlap_score(["japan", "tokyo", "osaka"], ["japan"])
        assert score == pytest.approx(1 / 3)


# ─────────────────────────────────────────────────────────────────────────────
# _recency_score
# ─────────────────────────────────────────────────────────────────────────────

class TestRecencyScore:
    def test_none_returns_default(self):
        from app.services.feed_ranking_service import _recency_score
        assert _recency_score(None) == 0.3

    def test_today_returns_approximately_one(self):
        from app.services.feed_ranking_service import _recency_score
        now = datetime.now(timezone.utc).isoformat()
        score = _recency_score(now)
        assert score > 0.95

    def test_thirty_days_ago_around_half(self):
        from app.services.feed_ranking_service import _recency_score
        thirty_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        score = _recency_score(thirty_ago)
        # exp(-30/60) ≈ 0.607
        assert 0.55 < score < 0.70

    def test_old_date_near_zero(self):
        from app.services.feed_ranking_service import _recency_score
        old = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        score = _recency_score(old)
        assert score < 0.05

    def test_invalid_string_returns_default(self):
        from app.services.feed_ranking_service import _recency_score
        assert _recency_score("not-a-date") == 0.3

    def test_z_suffix_handled(self):
        from app.services.feed_ranking_service import _recency_score
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        score = _recency_score(now)
        assert score > 0.9

    def test_scores_are_decreasing(self):
        from app.services.feed_ranking_service import _recency_score
        recent = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        older = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        assert _recency_score(recent) > _recency_score(older)


# ─────────────────────────────────────────────────────────────────────────────
# _engagement_score
# ─────────────────────────────────────────────────────────────────────────────

class TestEngagementScore:
    def test_zero_views_returns_zero(self):
        from app.services.feed_ranking_service import _engagement_score
        assert _engagement_score(0, 0) == 0.0

    def test_none_views_returns_zero(self):
        from app.services.feed_ranking_service import _engagement_score
        assert _engagement_score(None, None) == 0.0

    def test_high_view_count_caps_at_one(self):
        from app.services.feed_ranking_service import _engagement_score
        # 100M views + high likes should approach but not exceed 1.0
        score = _engagement_score(100_000_000, 10_000_000)
        assert score <= 1.0

    def test_moderate_engagement(self):
        from app.services.feed_ranking_service import _engagement_score
        # 1M views, 10k likes
        score = _engagement_score(1_000_000, 10_000)
        assert 0.0 < score <= 1.0

    def test_higher_likes_increases_score(self):
        from app.services.feed_ranking_service import _engagement_score
        low_likes = _engagement_score(100_000, 100)
        high_likes = _engagement_score(100_000, 10_000)
        assert high_likes > low_likes

    def test_none_likes_treated_as_zero(self):
        from app.services.feed_ranking_service import _engagement_score
        score_none = _engagement_score(10_000, None)
        score_zero = _engagement_score(10_000, 0)
        assert score_none == score_zero

    def test_score_between_zero_and_one(self):
        from app.services.feed_ranking_service import _engagement_score
        for views, likes in [(1, 0), (1000, 10), (1_000_000, 500_000)]:
            score = _engagement_score(views, likes)
            assert 0.0 <= score <= 1.0, f"score out of bounds for views={views}"


# ─────────────────────────────────────────────────────────────────────────────
# _matches_duration
# ─────────────────────────────────────────────────────────────────────────────

class TestMatchesDuration:
    def test_short_under_600(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(300, "short") is True

    def test_short_at_599(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(599, "short") is True

    def test_short_at_600_is_false(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(600, "short") is False

    def test_medium_at_600(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(600, "medium") is True

    def test_medium_at_1799(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(1799, "medium") is True

    def test_medium_at_1800_is_false(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(1800, "medium") is False

    def test_long_at_1800(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(1800, "long") is True

    def test_long_large_value(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(7200, "long") is True

    def test_unknown_filter_returns_true(self):
        from app.services.feed_ranking_service import _matches_duration
        assert _matches_duration(300, "unknown") is True
        assert _matches_duration(3000, "") is True


# ─────────────────────────────────────────────────────────────────────────────
# _flatten_vlog_itineraries
# ─────────────────────────────────────────────────────────────────────────────

class TestFlattenVlogItineraries:
    def test_dict_itinerary_sets_id(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1", "itineraries": {"id": "itin-99"}}
        result = _flatten_vlog_itineraries(v)
        assert result["itinerary_id"] == "itin-99"
        assert "itineraries" not in result

    def test_list_itinerary_sets_first_id(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1", "itineraries": [{"id": "itin-1"}, {"id": "itin-2"}]}
        result = _flatten_vlog_itineraries(v)
        assert result["itinerary_id"] == "itin-1"

    def test_empty_list_sets_none(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1", "itineraries": []}
        result = _flatten_vlog_itineraries(v)
        assert result["itinerary_id"] is None

    def test_none_itinerary_sets_none(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1", "itineraries": None}
        result = _flatten_vlog_itineraries(v)
        assert result["itinerary_id"] is None

    def test_missing_itinerary_key_sets_none(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1"}
        result = _flatten_vlog_itineraries(v)
        assert result["itinerary_id"] is None

    def test_mutates_and_returns_same_dict(self):
        from app.services.feed_ranking_service import _flatten_vlog_itineraries
        v = {"id": "vlog-1", "itineraries": {"id": "itin-1"}}
        result = _flatten_vlog_itineraries(v)
        assert result is v


# ─────────────────────────────────────────────────────────────────────────────
# get_trending_vlogs
# ─────────────────────────────────────────────────────────────────────────────

class TestGetTrendingVlogs:
    def test_returns_list_of_vlogs(self):
        from app.services.feed_ranking_service import get_trending_vlogs
        vlogs = [
            {"id": "v1", "title": "Tokyo", "view_count": 1000, "itineraries": None},
            {"id": "v2", "title": "Paris", "view_count": 500, "itineraries": None},
        ]
        db = _make_db({"vlogs": vlogs})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs(limit=10)
        assert len(result) == 2
        assert result[0]["id"] == "v1"

    def test_empty_result(self):
        from app.services.feed_ranking_service import get_trending_vlogs
        db = _make_db({"vlogs": []})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs()
        assert result == []

    def test_itinerary_id_injected(self):
        from app.services.feed_ranking_service import get_trending_vlogs
        vlogs = [{"id": "v1", "itineraries": {"id": "it-1"}}]
        db = _make_db({"vlogs": vlogs})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs()
        assert result[0]["itinerary_id"] == "it-1"


# ─────────────────────────────────────────────────────────────────────────────
# get_new_this_week
# ─────────────────────────────────────────────────────────────────────────────

class TestGetNewThisWeek:
    def test_returns_vlogs(self):
        from app.services.feed_ranking_service import get_new_this_week
        vlogs = [{"id": "v-new", "itineraries": []}]
        db = _make_db({"vlogs": vlogs})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week(limit=5)
        assert len(result) == 1

    def test_empty_returns_empty(self):
        from app.services.feed_ranking_service import get_new_this_week
        db = _make_db({"vlogs": []})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week()
        assert result == []

    def test_itinerary_id_set_to_none_for_empty_list(self):
        from app.services.feed_ranking_service import get_new_this_week
        vlogs = [{"id": "v-new", "itineraries": []}]
        db = _make_db({"vlogs": vlogs})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week()
        assert result[0]["itinerary_id"] is None


# ─────────────────────────────────────────────────────────────────────────────
# get_vlogs_by_platform
# ─────────────────────────────────────────────────────────────────────────────

class TestGetVlogsByPlatform:
    def test_returns_platform_vlogs(self):
        from app.services.feed_ranking_service import get_vlogs_by_platform
        vlogs = [{"id": "v1", "platform": "tiktok", "itineraries": None}]
        db = _make_db({"vlogs": vlogs})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_vlogs_by_platform("tiktok", limit=5)
        assert len(result) == 1

    def test_empty_result(self):
        from app.services.feed_ranking_service import get_vlogs_by_platform
        db = _make_db({"vlogs": []})
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_vlogs_by_platform("instagram")
        assert result == []


# ─────────────────────────────────────────────────────────────────────────────
# _mark_shown
# ─────────────────────────────────────────────────────────────────────────────

class TestMarkShown:
    def test_empty_list_skips_db_call(self):
        from app.services.feed_ranking_service import _mark_shown
        db = MagicMock()
        _mark_shown(db, "user-1", [])
        db.table.assert_not_called()

    def test_updates_shown_in_db(self):
        from app.services.feed_ranking_service import _mark_shown
        db = MagicMock()
        table_mock = MagicMock()
        db.table.return_value = table_mock
        table_mock.update.return_value = table_mock
        table_mock.eq.return_value = table_mock
        table_mock.in_.return_value = table_mock
        table_mock.execute.return_value = MagicMock()

        _mark_shown(db, "user-1", ["vlog-1", "vlog-2"])

        db.table.assert_called_once_with("feed_cache")
        table_mock.update.assert_called_once_with({"shown": True})

    def test_exception_is_swallowed(self):
        from app.services.feed_ranking_service import _mark_shown
        db = MagicMock()
        db.table.side_effect = Exception("DB error")
        # Should not raise
        _mark_shown(db, "user-1", ["vlog-1"])


# ─────────────────────────────────────────────────────────────────────────────
# build_feed_for_user
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildFeedForUser:
    def _make_full_db(self, prefs=None, vlogs=None, interactions=None, shown=None):
        """Build a DB mock with controllable responses per table query."""
        prefs_data = prefs or []
        vlogs_data = vlogs or []
        interactions_data = interactions or []
        shown_data = shown or []

        class _SmartTable:
            def __init__(self, name):
                self._name = name
                self._data_map = {
                    "taste_preferences": prefs_data,
                    "vlogs": vlogs_data,
                    "vlog_interactions": interactions_data,
                    "feed_cache": shown_data,
                }
                self._chain_data = self._data_map.get(name, [])

            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def in_(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def upsert(self, rows, *a, **kw): return self
            def update(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                r.data = self._chain_data
                return r

        db = MagicMock()
        db.table = lambda name: _SmartTable(name)
        return db

    def test_runs_without_prefs(self):
        from app.services.feed_ranking_service import build_feed_for_user
        db = self._make_full_db(vlogs=[
            {"id": "v1", "travel_styles": [], "destinations": [], "published_at": None,
             "view_count": 1000, "like_count": 100, "channel_id": "ch-1"}
        ])
        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
        ):
            build_feed_for_user("user-1")  # should not raise

    def test_no_vlogs_produces_no_upsert(self):
        from app.services.feed_ranking_service import build_feed_for_user
        upsert_called = []

        class _TrackingTable:
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def in_(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def update(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                r.data = []
                return r
            def upsert(self, rows, *a, **kw):
                upsert_called.append(rows)
                return self

        db = MagicMock()
        db.table = lambda name: _TrackingTable()
        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
        ):
            build_feed_for_user("user-1")
        assert upsert_called == []

    def test_subscription_score_applied(self):
        """Vlog from subscribed channel gets subscription_score=1.0."""
        from app.services.feed_ranking_service import build_feed_for_user
        upsert_rows = []

        class _TrackingTable:
            def __init__(self, name):
                self._name = name
                self._data = {
                    "taste_preferences": [],
                    "vlog_interactions": [],
                    "feed_cache": [],
                    "vlogs": [
                        {"id": "v1", "travel_styles": [], "destinations": [],
                         "published_at": None, "view_count": 0, "like_count": 0,
                         "channel_id": "SUBSCRIBED_CHANNEL"},
                    ],
                }

            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def in_(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def update(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                r.data = self._data.get(self._name, [])
                return r
            def upsert(self, rows, *a, **kw):
                upsert_rows.extend(rows)
                return self

        db = MagicMock()
        db.table = lambda name: _TrackingTable(name)
        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions",
                  return_value={"SUBSCRIBED_CHANNEL"}),
        ):
            build_feed_for_user("user-1")

        assert len(upsert_rows) == 1
        # subscription_score=1.0 contributes 0.20 to the score
        assert upsert_rows[0]["score"] >= 0.20

    def test_home_location_penalty(self):
        """Vlogs matching home_location should have lower scores."""
        from app.services.feed_ranking_service import build_feed_for_user
        upsert_rows_home = []
        upsert_rows_away = []

        def _run(home, destinations, collector):
            class _Table:
                def __init__(self, name):
                    self._name = name

                def select(self, *a, **kw): return self
                def eq(self, *a, **kw): return self
                def in_(self, *a, **kw): return self
                def order(self, *a, **kw): return self
                def limit(self, *a, **kw): return self
                def update(self, *a, **kw): return self
                def execute(self):
                    r = MagicMock()
                    data_map = {
                        "taste_preferences": [{"destinations": [], "travel_styles": [], "home_location": home}],
                        "vlog_interactions": [],
                        "feed_cache": [],
                        "vlogs": [
                            {"id": "v1", "travel_styles": [], "destinations": destinations,
                             "published_at": None, "view_count": 0, "like_count": 0, "channel_id": None},
                        ],
                    }
                    r.data = data_map.get(self._name, [])
                    return r
                def upsert(self, rows, *a, **kw):
                    collector.extend(rows)
                    return self

            db = MagicMock()
            db.table = lambda name: _Table(name)
            with (
                patch("app.services.feed_ranking_service.get_supabase", return_value=db),
                patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
            ):
                build_feed_for_user("user-1")

        _run("tokyo", ["Tokyo", "Japan"], upsert_rows_home)
        _run("london", ["Tokyo", "Japan"], upsert_rows_away)

        home_score = upsert_rows_home[0]["score"]
        away_score = upsert_rows_away[0]["score"]
        # Same vlog, but home penalty (0.4x) should make home_score much lower
        assert home_score < away_score

    def test_shown_penalty_applied(self):
        """Already-shown vlogs get 0.2x score penalty."""
        from app.services.feed_ranking_service import build_feed_for_user
        upsert_rows = []

        class _Table:
            def __init__(self, name):
                self._name = name

            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def in_(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def update(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                data_map = {
                    "taste_preferences": [],
                    "vlog_interactions": [],
                    "feed_cache": [{"vlog_id": "v1", "shown": True}],
                    "vlogs": [
                        {"id": "v1", "travel_styles": ["adventure"], "destinations": ["japan"],
                         "published_at": None, "view_count": 100000, "like_count": 5000, "channel_id": None},
                    ],
                }
                r.data = data_map.get(self._name, [])
                return r
            def upsert(self, rows, *a, **kw):
                upsert_rows.extend(rows)
                return self

        db = MagicMock()
        db.table = lambda name: _Table(name)
        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
        ):
            build_feed_for_user("user-1")

        assert upsert_rows[0]["shown"] is True


# ─────────────────────────────────────────────────────────────────────────────
# get_paginated_feed
# ─────────────────────────────────────────────────────────────────────────────

class TestGetPaginatedFeed:
    def _make_feed_db(self, cache_rows=None, direct_rows=None):
        cache_data = cache_rows or []
        direct_data = direct_rows or []

        class _Table:
            def __init__(self, name):
                self._name = name
                self._limit = None
                self._data = cache_data if name == "feed_cache" else direct_data

            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, n, *a, **kw):
                self._limit = n
                return self
            def execute(self):
                r = MagicMock()
                r.data = self._data
                return r

        db = MagicMock()
        db.table = lambda name: _Table(name)
        return db

    def test_empty_cache_returns_empty(self):
        from app.services.feed_ranking_service import get_paginated_feed
        db = self._make_feed_db()
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_paginated_feed("user-1")
        assert result["vlogs"] == []
        assert result["total"] == 0
        assert result["next_cursor"] is None

    def test_returns_vlogs_from_cache(self):
        from app.services.feed_ranking_service import get_paginated_feed
        vlog = {"id": "v1", "platform": "youtube", "destinations": [], "travel_styles": [],
                "duration_seconds": 600, "title": "Test", "channel_name": "Chan",
                "itineraries": None}
        cache = [{"score": 0.9, "reason_tags": [], "shown": False, "vlogs": vlog}]
        db = self._make_feed_db(cache_rows=cache)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_paginated_feed("user-1")
        assert len(result["vlogs"]) == 1
        assert result["vlogs"][0]["id"] == "v1"

    def test_platform_filter_excludes_non_matching(self):
        from app.services.feed_ranking_service import get_paginated_feed
        yt_vlog = {"id": "v-yt", "platform": "youtube", "destinations": [], "travel_styles": [],
                   "duration_seconds": 0, "title": "YT", "channel_name": "", "itineraries": None}
        tt_vlog = {"id": "v-tt", "platform": "tiktok", "destinations": [], "travel_styles": [],
                   "duration_seconds": 0, "title": "TT", "channel_name": "", "itineraries": None}
        cache = [
            {"score": 0.9, "reason_tags": [], "shown": False, "vlogs": yt_vlog},
            {"score": 0.8, "reason_tags": [], "shown": False, "vlogs": tt_vlog},
        ]

        class _FullDB:
            def table(self, name):
                return _NoOpTable(name, cache if name == "feed_cache" else [])

        class _NoOpTable:
            def __init__(self, name, data):
                self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                r.data = self._data
                return r

        with patch("app.services.feed_ranking_service.get_supabase", return_value=_FullDB()):
            result = get_paginated_feed("user-1", platform="tiktok")
        ids = [v["id"] for v in result["vlogs"]]
        assert "v-tt" in ids
        assert "v-yt" not in ids

    def test_destination_filter_on_title(self):
        from app.services.feed_ranking_service import get_paginated_feed
        vlog = {"id": "v-jp", "platform": "youtube", "destinations": [],
                "travel_styles": [], "duration_seconds": 0,
                "title": "Tokyo Japan Trip", "channel_name": "", "itineraries": None}
        vlog2 = {"id": "v-fr", "platform": "youtube", "destinations": [],
                 "travel_styles": [], "duration_seconds": 0,
                 "title": "Paris France Trip", "channel_name": "", "itineraries": None}
        cache = [
            {"score": 0.9, "reason_tags": [], "shown": False, "vlogs": vlog},
            {"score": 0.8, "reason_tags": [], "shown": False, "vlogs": vlog2},
        ]

        class _DB:
            def table(self, name):
                return _T(cache if name == "feed_cache" else [])
        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with patch("app.services.feed_ranking_service.get_supabase", return_value=_DB()):
            result = get_paginated_feed("user-1", destination="tokyo")
        assert len(result["vlogs"]) == 1
        assert result["vlogs"][0]["id"] == "v-jp"

    def test_duration_short_filter(self):
        from app.services.feed_ranking_service import get_paginated_feed
        short_vlog = {"id": "v-short", "platform": "youtube", "destinations": [],
                      "travel_styles": [], "duration_seconds": 300,
                      "title": "Short", "channel_name": "", "itineraries": None}
        long_vlog = {"id": "v-long", "platform": "youtube", "destinations": [],
                     "travel_styles": [], "duration_seconds": 3000,
                     "title": "Long", "channel_name": "", "itineraries": None}
        cache = [
            {"score": 0.9, "reason_tags": [], "shown": False, "vlogs": short_vlog},
            {"score": 0.8, "reason_tags": [], "shown": False, "vlogs": long_vlog},
        ]

        class _DB:
            def table(self, name):
                return _T(cache if name == "feed_cache" else [])
        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with patch("app.services.feed_ranking_service.get_supabase", return_value=_DB()):
            result = get_paginated_feed("user-1", duration="short")
        assert all(v["id"] == "v-short" for v in result["vlogs"])

    def test_cursor_pagination(self):
        from app.services.feed_ranking_service import get_paginated_feed
        vlogs = [
            {"id": f"v{i}", "platform": "youtube", "destinations": [], "travel_styles": [],
             "duration_seconds": 0, "title": f"V{i}", "channel_name": "", "itineraries": None}
            for i in range(25)
        ]
        cache = [{"score": 1.0 - i * 0.01, "reason_tags": [], "shown": False, "vlogs": vlogs[i]}
                 for i in range(25)]

        class _DB:
            def table(self, name):
                return _T(cache if name == "feed_cache" else [])
        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with patch("app.services.feed_ranking_service.get_supabase", return_value=_DB()):
            result = get_paginated_feed("user-1", limit=20)
        assert result["next_cursor"] is not None
        assert len(result["vlogs"]) == 20

    def test_shown_ids_in_result(self):
        from app.services.feed_ranking_service import get_paginated_feed
        vlog = {"id": "v1", "platform": "youtube", "destinations": [], "travel_styles": [],
                "duration_seconds": 0, "title": "T", "channel_name": "", "itineraries": None}
        cache = [{"score": 0.8, "reason_tags": [], "shown": False, "vlogs": vlog}]

        class _DB:
            def table(self, name):
                return _T(cache if name == "feed_cache" else [])
        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def order(self, *a, **kw): return self
            def lt(self, *a, **kw): return self
            def gte(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with patch("app.services.feed_ranking_service.get_supabase", return_value=_DB()):
            result = get_paginated_feed("user-1")
        assert "v1" in result["_shown_ids"]
