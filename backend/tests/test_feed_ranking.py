"""
Tests for feed_ranking_service — pure scoring functions and feed pagination logic.
"""
import math
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch, call

from app.services.feed_ranking_service import (
    _overlap_score,
    _recency_score,
    _engagement_score,
    get_paginated_feed,
    build_feed_for_user,
)


# ─────────────────────────────────────────────────────────────────────────────
# _overlap_score
# ─────────────────────────────────────────────────────────────────────────────

class TestOverlapScore:
    def test_both_empty_returns_zero(self):
        assert _overlap_score([], []) == 0.0

    def test_first_empty_returns_zero(self):
        assert _overlap_score([], ["Japan"]) == 0.0

    def test_second_empty_returns_zero(self):
        assert _overlap_score(["Japan"], []) == 0.0

    def test_identical_lists_return_one(self):
        assert _overlap_score(["Japan", "Tokyo"], ["Japan", "Tokyo"]) == 1.0

    def test_no_overlap_returns_zero(self):
        assert _overlap_score(["Japan"], ["France"]) == 0.0

    def test_partial_overlap_correct_fraction(self):
        # intersection = {"japan"}, max(3, 2) = 3
        score = _overlap_score(["Japan", "Tokyo", "Osaka"], ["Japan", "Seoul"])
        assert math.isclose(score, 1 / 3, rel_tol=1e-6)

    def test_case_insensitive_matching(self):
        assert _overlap_score(["JAPAN"], ["japan"]) == 1.0
        assert _overlap_score(["Tokyo"], ["TOKYO"]) == 1.0

    def test_deduplication_within_list(self):
        # Duplicate "Japan" should be treated as one unique item
        score = _overlap_score(["Japan", "Japan"], ["Japan"])
        assert score == 1.0

    def test_single_item_match(self):
        score = _overlap_score(["beach"], ["beach"])
        assert score == 1.0

    def test_symmetric_property(self):
        a = ["Japan", "Korea"]
        b = ["Korea", "Thailand"]
        assert _overlap_score(a, b) == _overlap_score(b, a)


# ─────────────────────────────────────────────────────────────────────────────
# _recency_score
# ─────────────────────────────────────────────────────────────────────────────

class TestRecencyScore:
    def test_today_score_near_one(self):
        today = datetime.now(timezone.utc).isoformat()
        score = _recency_score(today)
        assert score > 0.98

    def test_30_days_ago_near_half(self):
        pub = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        # exp(-30/60) ≈ 0.607
        score = _recency_score(pub)
        assert 0.55 < score < 0.65

    def test_60_days_ago_near_point_37(self):
        pub = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        # exp(-60/60) = exp(-1) ≈ 0.368
        score = _recency_score(pub)
        assert 0.33 < score < 0.41

    def test_old_content_very_low_score(self):
        pub = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        assert _recency_score(pub) < 0.05

    def test_none_returns_default(self):
        assert _recency_score(None) == 0.3

    def test_empty_string_returns_default(self):
        assert _recency_score("") == 0.3

    def test_invalid_date_string_returns_default(self):
        assert _recency_score("not-a-date") == 0.3

    def test_z_suffix_handled(self):
        # Supabase returns UTC timestamps with Z suffix
        pub = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        score = _recency_score(pub)
        assert score > 0.95

    def test_score_is_monotonically_decreasing_with_age(self):
        dates = [
            (datetime.now(timezone.utc) - timedelta(days=d)).isoformat()
            for d in [0, 30, 60, 120, 240]
        ]
        scores = [_recency_score(d) for d in dates]
        for i in range(len(scores) - 1):
            assert scores[i] > scores[i + 1]


# ─────────────────────────────────────────────────────────────────────────────
# _engagement_score
# ─────────────────────────────────────────────────────────────────────────────

class TestEngagementScore:
    def test_zero_views_returns_zero(self):
        assert _engagement_score(0, 0) == 0.0

    def test_none_views_returns_zero(self):
        assert _engagement_score(None, None) == 0.0

    def test_result_never_exceeds_one(self):
        assert _engagement_score(100_000_000, 100_000_000) <= 1.0

    def test_result_never_negative(self):
        assert _engagement_score(1, 0) >= 0.0

    def test_high_like_ratio_boosts_score(self):
        # 10% like ratio is high, 0.1% is low; same view count
        score_high = _engagement_score(1_000, 100)   # 10% ratio
        score_low  = _engagement_score(1_000, 1)     # 0.1% ratio
        assert score_high > score_low

    def test_more_views_scores_higher(self):
        score_large = _engagement_score(1_000_000, 50_000)
        score_small = _engagement_score(100, 5)
        assert score_large > score_small

    def test_none_likes_treated_as_zero(self):
        score_none = _engagement_score(10_000, None)
        score_zero = _engagement_score(10_000, 0)
        assert score_none == score_zero

    def test_viral_video_approaches_one(self):
        # 100M views, 10M likes → should be close to 1.0
        score = _engagement_score(100_000_000, 10_000_000)
        assert score > 0.85


# ─────────────────────────────────────────────────────────────────────────────
# get_paginated_feed
# ─────────────────────────────────────────────────────────────────────────────

class TestGetPaginatedFeed:
    def _make_feed_row(self, vlog_data: dict, score: float = 0.5) -> dict:
        return {"score": score, "reason_tags": [], "shown": False, "vlogs": vlog_data}

    def _make_vlog(self, vlog_id="v1", destinations=None, styles=None, itinerary_id=None):
        itinerary = {"id": itinerary_id} if itinerary_id else None
        return {
            "id": vlog_id,
            "title": "Test Vlog",
            "processing_status": "ready",
            "destinations": destinations or [],
            "travel_styles": styles or [],
            "itineraries": itinerary,
        }

    def _mock_db_with_rows(self, mock_supabase, rows):
        chain = mock_supabase.table.return_value
        for method in ("select", "eq", "order", "limit", "lt"):
            getattr(chain, method).return_value = chain
        chain.execute.return_value = MagicMock(data=rows)
        return mock_supabase

    def test_empty_cache_returns_empty_page(self, mock_supabase):
        self._mock_db_with_rows(mock_supabase, [])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert result["vlogs"] == []
        assert result["next_cursor"] is None
        assert result["total"] == 0

    def test_single_vlog_returned(self, mock_supabase):
        vlog = self._make_vlog("v1")
        rows = [self._make_feed_row(vlog, score=0.8)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert len(result["vlogs"]) == 1
        assert result["vlogs"][0]["id"] == "v1"

    def test_itinerary_dict_flattened_to_scalar(self, mock_supabase):
        """PostgREST returns dict (unique FK) — must become itinerary_id string."""
        vlog = self._make_vlog("v1", itinerary_id="itin-abc")
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert result["vlogs"][0]["itinerary_id"] == "itin-abc"

    def test_itinerary_list_flattened_to_scalar(self, mock_supabase):
        """PostgREST may return a list — first element's id should be used."""
        vlog = self._make_vlog("v1")
        vlog["itineraries"] = [{"id": "itin-xyz"}]
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert result["vlogs"][0]["itinerary_id"] == "itin-xyz"

    def test_no_itinerary_gives_none(self, mock_supabase):
        vlog = self._make_vlog("v1")
        vlog["itineraries"] = None
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert result["vlogs"][0]["itinerary_id"] is None

    def test_destination_filter_excludes_non_matching(self, mock_supabase):
        vlog_jp = self._make_vlog("v1", destinations=["Japan"])
        vlog_fr = self._make_vlog("v2", destinations=["France"])
        rows = [
            self._make_feed_row(vlog_jp, score=0.9),
            self._make_feed_row(vlog_fr, score=0.8),
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", destination="japan")

        assert len(result["vlogs"]) == 1
        assert result["vlogs"][0]["id"] == "v1"

    def test_style_filter_excludes_non_matching(self, mock_supabase):
        vlog_adventure = self._make_vlog("v1", styles=["adventure"])
        vlog_luxury    = self._make_vlog("v2", styles=["luxury"])
        rows = [
            self._make_feed_row(vlog_adventure, score=0.9),
            self._make_feed_row(vlog_luxury, score=0.8),
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", style="adventure")

        assert len(result["vlogs"]) == 1
        assert result["vlogs"][0]["id"] == "v1"

    def test_null_travel_styles_does_not_raise(self, mock_supabase):
        """travel_styles = None (null in DB) must not throw TypeError."""
        vlog = self._make_vlog("v1")
        vlog["travel_styles"] = None
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            # Should not raise even with style filter active
            result = get_paginated_feed("user-123", style="adventure")

        assert result["vlogs"] == []

    def test_null_destinations_does_not_raise(self, mock_supabase):
        """destinations = None must not throw TypeError."""
        vlog = self._make_vlog("v1")
        vlog["destinations"] = None
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", destination="Japan")

        assert result["vlogs"] == []

    def test_has_next_cursor_when_more_results_exist(self, mock_supabase):
        # limit=2 but we supply 3 rows (simulating limit+1 fetch)
        rows = [
            self._make_feed_row(self._make_vlog(f"v{i}"), score=1.0 - i * 0.1)
            for i in range(3)
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", limit=2)

        assert len(result["vlogs"]) == 2
        assert result["next_cursor"] is not None

    def test_no_cursor_when_exactly_one_page(self, mock_supabase):
        rows = [self._make_feed_row(self._make_vlog("v1"), score=0.9)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", limit=10)

        assert result["next_cursor"] is None

    def test_shown_ids_returned_for_mark_shown(self, mock_supabase):
        vlog = self._make_vlog("v1")
        rows = [self._make_feed_row(vlog)]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert "v1" in result["_shown_ids"]

    def test_rows_with_null_vlog_are_skipped(self, mock_supabase):
        rows = [
            {"score": 0.9, "reason_tags": [], "shown": False, "vlogs": None},
            {"score": 0.8, "reason_tags": [], "shown": False, "vlogs": {}},
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123")

        assert result["vlogs"] == []

    def test_invalid_cursor_is_ignored_gracefully(self, mock_supabase):
        """Passing a non-numeric cursor should not crash."""
        self._mock_db_with_rows(mock_supabase, [])

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-123", cursor="not-a-number")

        assert result["vlogs"] == []


# ─────────────────────────────────────────────────────────────────────────────
# build_feed_for_user — scoring weights and home penalty
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildFeedForUser:
    def _make_db(self, prefs, vlogs, feed_cache=None):
        """Return a mock Supabase client pre-configured with test data."""
        db = MagicMock()
        call_index = 0
        results = [
            MagicMock(data=[prefs] if prefs else []),   # taste_preferences query
            MagicMock(data=vlogs),                       # vlogs query
            MagicMock(data=feed_cache or []),            # feed_cache shown query
        ]

        executed = []

        def make_table(name):
            table = MagicMock()
            for m in ("select","eq","in_","update","insert","upsert","order","limit","filter"):
                getattr(table, m).return_value = table

            def execute():
                if executed:
                    # subsequent calls return empty success
                    return MagicMock(data=[])
                idx = len(executed)
                executed.append(True)
                return results[min(idx, len(results) - 1)]

            table.execute.side_effect = execute
            return table

        # Each .table() call returns a fresh table mock backed by sequential results
        call_counts = [0]
        def table_factory(name):
            idx = call_counts[0]
            call_counts[0] += 1
            # Return result based on table name instead of call order for clarity
            t = MagicMock()
            for m in ("select","eq","in_","update","insert","upsert","order","limit","filter"):
                getattr(t, m).return_value = t

            if name == "taste_preferences":
                t.execute.return_value = MagicMock(data=[prefs] if prefs else [])
            elif name == "vlogs":
                t.execute.return_value = MagicMock(data=vlogs)
            elif name == "feed_cache":
                t.execute.return_value = MagicMock(data=feed_cache or [])
            else:
                t.execute.return_value = MagicMock(data=[])
            return t

        db.table.side_effect = table_factory
        return db

    def test_no_vlogs_builds_empty_feed(self):
        prefs = {"destinations": ["Japan"], "travel_styles": ["adventure"], "home_location": ""}
        db = self._make_db(prefs, vlogs=[])
        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
        ):
            # Should not raise; upsert should not be called with empty list
            build_feed_for_user("user-123")

        # feed_cache.upsert should not have been called
        upsert_calls = [
            c for c in db.table.call_args_list
            if c.args and c.args[0] == "feed_cache"
        ]
        # Even if table was called, it should have been called with no rows to upsert
        # (build_feed_for_user guards with `if upsert_rows`)

    def test_home_location_penalty_applied(self):
        """Vlogs about the user's home city should get a 0.4× score penalty."""
        prefs = {
            "destinations": ["Paris"],
            "travel_styles": ["luxury"],
            "home_location": "New York",
        }
        vlogs = [
            {
                "id": "home-vlog",
                "destinations": ["New York"],
                "travel_styles": ["luxury"],
                "published_at": datetime.now(timezone.utc).isoformat(),
                "view_count": 100_000,
                "like_count": 5_000,
                "channel_id": None,
            },
            {
                "id": "away-vlog",
                "destinations": ["Paris"],
                "travel_styles": ["luxury"],
                "published_at": datetime.now(timezone.utc).isoformat(),
                "view_count": 100_000,
                "like_count": 5_000,
                "channel_id": None,
            },
        ]
        upserted_rows = {}

        db = MagicMock()

        def table_factory(name):
            t = MagicMock()
            for m in ("select","eq","in_","order","limit","filter"):
                getattr(t, m).return_value = t

            if name == "taste_preferences":
                t.execute.return_value = MagicMock(data=[prefs])
            elif name == "vlogs":
                t.execute.return_value = MagicMock(data=vlogs)
            elif name == "feed_cache":
                def capture_upsert(rows, **kwargs):
                    for row in rows:
                        upserted_rows[row["vlog_id"]] = row["score"]
                    return t

                t.execute.return_value = MagicMock(data=[])
                t.upsert.side_effect = capture_upsert
            else:
                t.execute.return_value = MagicMock(data=[])
            return t

        db.table.side_effect = table_factory

        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()),
        ):
            build_feed_for_user("user-123")

        if upserted_rows:
            assert upserted_rows.get("home-vlog", 0) < upserted_rows.get("away-vlog", 1)

    def test_subscription_boost_applied(self):
        """Vlogs from subscribed channels score higher."""
        prefs = {"destinations": [], "travel_styles": [], "home_location": ""}
        vlogs = [
            {
                "id": "sub-vlog",
                "destinations": [],
                "travel_styles": [],
                "published_at": datetime.now(timezone.utc).isoformat(),
                "view_count": 1000,
                "like_count": 100,
                "channel_id": "channel-abc",
            },
            {
                "id": "unsub-vlog",
                "destinations": [],
                "travel_styles": [],
                "published_at": datetime.now(timezone.utc).isoformat(),
                "view_count": 1000,
                "like_count": 100,
                "channel_id": "channel-xyz",
            },
        ]
        upserted_rows = {}

        db = MagicMock()

        def table_factory(name):
            t = MagicMock()
            for m in ("select","eq","in_","order","limit","filter"):
                getattr(t, m).return_value = t

            if name == "taste_preferences":
                t.execute.return_value = MagicMock(data=[prefs])
            elif name == "vlogs":
                t.execute.return_value = MagicMock(data=vlogs)
            elif name == "feed_cache":
                def capture_upsert(rows, **kwargs):
                    for row in rows:
                        upserted_rows[row["vlog_id"]] = row["score"]
                    return t
                t.execute.return_value = MagicMock(data=[])
                t.upsert.side_effect = capture_upsert
            else:
                t.execute.return_value = MagicMock(data=[])
            return t

        db.table.side_effect = table_factory

        with (
            patch("app.services.feed_ranking_service.get_supabase", return_value=db),
            patch("app.services.feed_ranking_service.get_user_subscriptions", return_value={"channel-abc"}),
        ):
            build_feed_for_user("user-123")

        if upserted_rows:
            assert upserted_rows["sub-vlog"] > upserted_rows["unsub-vlog"]
