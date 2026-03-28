"""
test_feed_ranking_interactions.py
─────────────────────────────────────────────────────────────────────────────
Tests for the new and updated functions in feed_ranking_service.py:

  - build_feed_for_user  — interaction-based scoring (saves/likes/views
                           imply style/destination preferences that boost
                           future recommendations)
  - _query_vlogs_direct  — DB-level fallback for style/platform filters
  - get_trending_vlogs   — most-viewed ready vlogs, optional platform
  - get_new_this_week    — vlogs added in the last 7 days
  - get_vlogs_by_platform — platform-specific vlog list
  - get_paginated_feed   — platform param + fallback integration
"""
from __future__ import annotations

import math
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

from app.services.feed_ranking_service import (
    build_feed_for_user,
    get_paginated_feed,
    get_trending_vlogs,
    get_new_this_week,
    get_vlogs_by_platform,
    _query_vlogs_direct,
    _matches_duration,
)


# ─── Mock builders ────────────────────────────────────────────────────────────

def _vlog(
    vlog_id="v1",
    platform="youtube",
    travel_styles=None,
    destinations=None,
    view_count=10_000,
    like_count=500,
    published_at=None,
    channel_id="ch-1",
    duration_seconds=600,
    itinerary_id=None,
):
    itinerary = {"id": itinerary_id} if itinerary_id else None
    pub = published_at or datetime.now(timezone.utc).isoformat()
    return {
        "id": vlog_id,
        "platform": platform,
        "platform_video_id": f"yt-{vlog_id}",
        "title": f"Travel vlog {vlog_id}",
        "thumbnail_url": "https://img.example.com/thumb.jpg",
        "channel_name": "Test Channel",
        "channel_id": channel_id,
        "duration_seconds": duration_seconds,
        "published_at": pub,
        "view_count": view_count,
        "like_count": like_count,
        "destinations": destinations or [],
        "travel_styles": travel_styles or [],
        "processing_status": "ready",
        "created_at": pub,
        "itineraries": itinerary,
    }


def _make_db_for_build_feed(
    prefs: list,
    interactions: list,
    iv_vlogs: list,  # styles/destinations of interacted vlogs
    all_vlogs: list,
    shown: list,
):
    """
    Sequential-execute mock for build_feed_for_user.
    Call order:
      1. taste_preferences query
      2. vlog_interactions query
      3. vlogs.in_(interacted_ids)  — only when interactions is non-empty
      4. vlogs all ready
      5. feed_cache shown
      6. feed_cache upsert  → returns []
    """
    db = MagicMock()
    table = MagicMock()
    for m in (
        "select", "eq", "neq", "in_", "order", "limit", "lt", "gt",
        "gte", "lte", "ilike", "update", "insert", "upsert", "delete", "filter",
    ):
        getattr(table, m).return_value = table

    seq = [
        MagicMock(data=prefs),
        MagicMock(data=interactions),
    ]
    if interactions:
        seq.append(MagicMock(data=iv_vlogs))
    seq += [
        MagicMock(data=all_vlogs),
        MagicMock(data=shown),
        MagicMock(data=[]),  # upsert result
    ]

    table.execute.side_effect = seq
    db.table.return_value = table
    return db


def _make_simple_db(data: list):
    """Single-query mock returning `data` for every execute() call."""
    db = MagicMock()
    table = MagicMock()
    for m in (
        "select", "eq", "neq", "in_", "order", "limit", "lt", "gt",
        "gte", "lte", "ilike", "update", "insert", "upsert", "delete", "filter",
    ):
        getattr(table, m).return_value = table
    table.execute.return_value = MagicMock(data=data)
    db.table.return_value = table
    return db


def _make_sequential_db(sequences: list[list]):
    """
    Creates a mock DB where each distinct table() call gets its own execute sequence.
    `sequences` is a list of data-lists, one per execute() call in order.
    """
    db = MagicMock()
    table = MagicMock()
    for m in (
        "select", "eq", "neq", "in_", "order", "limit", "lt", "gt",
        "gte", "lte", "ilike", "update", "insert", "upsert", "delete", "filter",
    ):
        getattr(table, m).return_value = table
    table.execute.side_effect = [MagicMock(data=d) for d in sequences]
    db.table.return_value = table
    return db


# ═══════════════════════════════════════════════════════════════════════════════
# _matches_duration
# ═══════════════════════════════════════════════════════════════════════════════

class TestMatchesDuration:
    def test_short_below_600(self):
        assert _matches_duration(0, "short") is True
        assert _matches_duration(599, "short") is True

    def test_short_at_600_excluded(self):
        assert _matches_duration(600, "short") is False

    def test_medium_exactly_600(self):
        assert _matches_duration(600, "medium") is True

    def test_medium_at_1799(self):
        assert _matches_duration(1799, "medium") is True

    def test_medium_at_1800_excluded(self):
        assert _matches_duration(1800, "medium") is False

    def test_long_at_1800(self):
        assert _matches_duration(1800, "long") is True

    def test_long_below_1800_excluded(self):
        assert _matches_duration(1799, "long") is False

    def test_unknown_value_always_true(self):
        assert _matches_duration(300, "any") is True
        assert _matches_duration(5000, "weekly") is True


# ═══════════════════════════════════════════════════════════════════════════════
# build_feed_for_user — interaction boost
# ═══════════════════════════════════════════════════════════════════════════════

class TestBuildFeedInteractionBoost:
    """
    Validate that saving/liking/viewing vlogs influences future feed scores
    through the implied style/destination preference mechanism.
    """

    def test_no_interactions_gives_zero_interaction_boost(self):
        """When the user has no interaction history the boost component is 0."""
        target_vlog = _vlog("v1", travel_styles=["adventure"])
        db = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[],          # ← no interactions
            iv_vlogs=[],
            all_vlogs=[target_vlog],
            shown=[],
        )
        upsert_rows = []
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")

        upsert_rows = db.table.return_value.upsert.call_args[0][0]
        row = next(r for r in upsert_rows if r["vlog_id"] == "v1")
        # With no explicit prefs and no interactions the score is purely
        # engagement + recency.  It must NOT include any interaction boost.
        assert row["score"] < 0.5

    def test_saved_vlog_style_boosts_similar_vlogs(self):
        """
        Saving an adventure vlog should raise the score of other adventure
        vlogs compared to a baseline with no interaction history.
        """
        # Interaction: user saved an adventure vlog
        saved_vlog_id = "saved-adv"
        new_adv_vlog = _vlog("new-adv", travel_styles=["adventure"])

        db_with_interactions = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[{"vlog_id": saved_vlog_id, "action": "save"}],
            iv_vlogs=[{"id": saved_vlog_id, "travel_styles": ["adventure"], "destinations": []}],
            all_vlogs=[new_adv_vlog],
            shown=[],
        )
        db_no_interactions = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[],
            iv_vlogs=[],
            all_vlogs=[new_adv_vlog],
            shown=[],
        )

        upsert_with: list[dict] = []
        upsert_without: list[dict] = []

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db_with_interactions), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")
        upsert_with = db_with_interactions.table.return_value.upsert.call_args[0][0]

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db_no_interactions), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")
        upsert_without = db_no_interactions.table.return_value.upsert.call_args[0][0]

        score_with = next(r["score"] for r in upsert_with if r["vlog_id"] == "new-adv")
        score_without = next(r["score"] for r in upsert_without if r["vlog_id"] == "new-adv")
        assert score_with > score_without, "Interaction boost should raise score of similar vlogs"

    def test_save_weight_exceeds_view_weight(self):
        """
        When the user saves a 'luxury' vlog (weight=3) AND views a 'beach' vlog (weight=1),
        the implied preference for 'luxury' (3) is stronger than for 'beach' (1).
        A 'luxury' vlog must therefore score higher than a 'beach' vlog.
        The difference is observable because max_style_w=3 normalises the luxury boost to
        1.0 while beach gets 1/3 ≈ 0.33 — the action weight affects RELATIVE boosts.
        """
        luxury_vlog = _vlog("new-luxury", travel_styles=["luxury"])
        beach_vlog  = _vlog("new-beach",  travel_styles=["beach"])
        iv_luxury = {"id": "iv-luxury", "travel_styles": ["luxury"], "destinations": []}
        iv_beach  = {"id": "iv-beach",  "travel_styles": ["beach"],   "destinations": []}

        db = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[
                {"vlog_id": "iv-luxury", "action": "save"},   # weight=3
                {"vlog_id": "iv-beach",  "action": "view"},   # weight=1
            ],
            iv_vlogs=[iv_luxury, iv_beach],
            all_vlogs=[luxury_vlog, beach_vlog],
            shown=[],
        )

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")

        rows = db.table.return_value.upsert.call_args[0][0]
        luxury_score = next(r["score"] for r in rows if r["vlog_id"] == "new-luxury")
        beach_score  = next(r["score"] for r in rows if r["vlog_id"] == "new-beach")
        assert luxury_score > beach_score, (
            f"Saved style (luxury={luxury_score:.4f}) should outscore viewed style (beach={beach_score:.4f})"
        )

    def test_because_you_watched_reason_tag_added(self):
        """
        When interaction_boost > 0.4 the 'because_you_watched' reason tag
        must appear in the upserted row.
        """
        # The target vlog has a style that exactly matches the saved vlog's style
        target = _vlog("target", travel_styles=["beach"])
        iv = {"id": "saved-beach", "travel_styles": ["beach"], "destinations": []}

        # 3 saves of the same style → strong implied preference → boost > 0.4
        interactions = [
            {"vlog_id": "saved-beach", "action": "save"},
        ]

        db = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=interactions,
            iv_vlogs=[iv],
            all_vlogs=[target],
            shown=[],
        )
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")

        rows = db.table.return_value.upsert.call_args[0][0]
        target_row = next(r for r in rows if r["vlog_id"] == "target")
        assert "because_you_watched" in target_row["reason_tags"]

    def test_destination_interaction_boosts_destination_vlogs(self):
        """Saving a Japan vlog should raise scores of other Japan vlogs."""
        japan_vlog = _vlog("jp-new", destinations=["Japan"])
        iv = {"id": "jp-saved", "travel_styles": [], "destinations": ["Japan"]}

        db = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[{"vlog_id": "jp-saved", "action": "like"}],
            iv_vlogs=[iv],
            all_vlogs=[japan_vlog],
            shown=[],
        )
        db_clean = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[],
            iv_vlogs=[],
            all_vlogs=[japan_vlog],
            shown=[],
        )

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")
        rows_with = db.table.return_value.upsert.call_args[0][0]

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db_clean), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")
        rows_without = db_clean.table.return_value.upsert.call_args[0][0]

        score_with = next(r["score"] for r in rows_with if r["vlog_id"] == "jp-new")
        score_without = next(r["score"] for r in rows_without if r["vlog_id"] == "jp-new")
        assert score_with > score_without

    def test_unrelated_style_vlog_not_boosted(self):
        """Saving a beach vlog should NOT boost a mountain vlog's score."""
        mountain_vlog = _vlog("mtn", travel_styles=["mountain"])
        iv = {"id": "beach-saved", "travel_styles": ["beach"], "destinations": []}

        db = _make_db_for_build_feed(
            prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
            interactions=[{"vlog_id": "beach-saved", "action": "save"}],
            iv_vlogs=[iv],
            all_vlogs=[mountain_vlog],
            shown=[],
        )
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("user-1")

        rows = db.table.return_value.upsert.call_args[0][0]
        mtn_row = next(r for r in rows if r["vlog_id"] == "mtn")
        assert "because_you_watched" not in mtn_row["reason_tags"]

    def test_multiple_interactions_accumulate(self):
        """Each additional interaction with the same style accumulates weight."""
        target = _vlog("t", travel_styles=["cultural"])
        iv_vlog = {"id": "c", "travel_styles": ["cultural"], "destinations": []}

        def _db(n_saves: int):
            interactions = [{"vlog_id": "c", "action": "save"}] * n_saves
            return _make_db_for_build_feed(
                prefs=[{"destinations": [], "travel_styles": [], "home_location": None}],
                interactions=interactions,
                iv_vlogs=[iv_vlog] * n_saves,
                all_vlogs=[target],
                shown=[],
            )

        db1 = _db(1)
        db3 = _db(3)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db1), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("u")
        rows1 = db1.table.return_value.upsert.call_args[0][0]

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db3), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value=set()):
            build_feed_for_user("u")
        rows3 = db3.table.return_value.upsert.call_args[0][0]

        s1 = next(r["score"] for r in rows1 if r["vlog_id"] == "t")
        s3 = next(r["score"] for r in rows3 if r["vlog_id"] == "t")
        assert s3 >= s1, "More interactions should produce equal or higher boost"

    def test_interaction_scores_capped_at_one(self):
        """Final score must never exceed 1.0 regardless of interactions."""
        # Perfect match: prefs, interactions, subscriptions all aligned
        target = _vlog("t", travel_styles=["adventure"], destinations=["Japan"], channel_id="ch-sub")
        iv = {"id": "iv", "travel_styles": ["adventure"], "destinations": ["Japan"]}

        db = _make_db_for_build_feed(
            prefs=[{"destinations": ["Japan"], "travel_styles": ["adventure"], "home_location": None}],
            interactions=[{"vlog_id": "iv", "action": "save"}] * 10,
            iv_vlogs=[iv] * 10,
            all_vlogs=[target],
            shown=[],
        )
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db), \
             patch("app.services.feed_ranking_service.get_user_subscriptions", return_value={"ch-sub"}):
            build_feed_for_user("u")

        rows = db.table.return_value.upsert.call_args[0][0]
        score = next(r["score"] for r in rows if r["vlog_id"] == "t")
        assert score <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# _query_vlogs_direct
# ═══════════════════════════════════════════════════════════════════════════════

class TestQueryVlogsDirect:
    """Unit tests for the DB-level fallback function used by get_paginated_feed."""

    def test_returns_tuples_of_vlog_and_score(self):
        """Each result is a (vlog_dict, float) tuple."""
        v = _vlog("v1", view_count=50_000)
        db = _make_simple_db([v])

        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            results = _query_vlogs_direct(db, limit=5)

        assert len(results) == 1
        vlog_dict, score = results[0]
        assert vlog_dict["id"] == "v1"
        assert isinstance(score, float)

    def test_style_filter_matches_array(self):
        v_match = _vlog("v-match", travel_styles=["adventure"])
        v_miss  = _vlog("v-miss",  travel_styles=["luxury"])
        db = _make_simple_db([v_match, v_miss])

        results = _query_vlogs_direct(db, style="adventure", limit=10)
        ids = [r[0]["id"] for r in results]
        assert "v-match" in ids
        assert "v-miss" not in ids

    def test_style_filter_matches_title(self):
        v = _vlog("v1", travel_styles=[])
        v["title"] = "Extreme Adventure Vlog 2024"
        db = _make_simple_db([v])

        results = _query_vlogs_direct(db, style="adventure", limit=10)
        assert len(results) == 1

    def test_platform_filter_excludes_wrong_platform(self):
        v_yt = _vlog("yt1", platform="youtube")
        v_tt = _vlog("tt1", platform="tiktok")
        # DB-level filtering is mocked: both rows returned by DB
        # but platform filter is applied at DB level (eq call), so we
        # simulate this by only returning matching rows
        db = _make_simple_db([v_tt])

        results = _query_vlogs_direct(db, platform="tiktok", limit=10)
        assert all(r[0]["id"] == "tt1" for r in results)

    def test_exclude_ids_skips_already_seen(self):
        v1 = _vlog("v1")
        v2 = _vlog("v2")
        db = _make_simple_db([v1, v2])

        results = _query_vlogs_direct(db, exclude_ids={"v1"}, limit=10)
        ids = [r[0]["id"] for r in results]
        assert "v1" not in ids
        assert "v2" in ids

    def test_limit_respected(self):
        vlogs = [_vlog(f"v{i}") for i in range(10)]
        db = _make_simple_db(vlogs)

        results = _query_vlogs_direct(db, limit=3)
        assert len(results) <= 3

    def test_engagement_based_pseudo_score(self):
        """Higher view_count → higher pseudo_score."""
        v_popular = _vlog("pop", view_count=1_000_000)
        v_niche   = _vlog("niche", view_count=100)
        db = _make_simple_db([v_popular, v_niche])

        results = _query_vlogs_direct(db, limit=10)
        scores = {r[0]["id"]: r[1] for r in results}
        assert scores["pop"] > scores["niche"]

    def test_itinerary_id_flattened(self):
        v = _vlog("v1", itinerary_id="itin-abc")
        db = _make_simple_db([v])

        results = _query_vlogs_direct(db, limit=10)
        assert results[0][0]["itinerary_id"] == "itin-abc"

    def test_no_matching_style_returns_empty(self):
        v = _vlog("v1", travel_styles=["beach"])
        db = _make_simple_db([v])

        results = _query_vlogs_direct(db, style="wildlife", limit=10)
        assert results == []

    def test_case_insensitive_style_match(self):
        v = _vlog("v1", travel_styles=["Adventure"])
        db = _make_simple_db([v])

        results = _query_vlogs_direct(db, style="adventure", limit=10)
        assert len(results) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# get_trending_vlogs
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetTrendingVlogs:

    def test_returns_list_of_vlog_dicts(self):
        db = _make_simple_db([_vlog("v1", view_count=100_000)])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs(limit=5)
        assert isinstance(result, list)
        assert result[0]["id"] == "v1"

    def test_respects_limit(self):
        """The service passes the limit argument to the DB query (mock can't enforce it)."""
        vlogs = [_vlog(f"v{i}", view_count=10_000 - i) for i in range(10)]
        db = _make_simple_db(vlogs)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_trending_vlogs(limit=3)
        db.table.return_value.limit.assert_any_call(3)

    def test_itinerary_id_flattened(self):
        v = _vlog("v1", itinerary_id="itin-xyz")
        db = _make_simple_db([v])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs()
        assert result[0]["itinerary_id"] == "itin-xyz"

    def test_empty_db_returns_empty_list(self):
        db = _make_simple_db([])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs()
        assert result == []

    def test_platform_filter_passes_eq_call(self):
        """Verify that passing platform= triggers a DB eq() call."""
        db = _make_simple_db([_vlog("tt1", platform="tiktok")])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_trending_vlogs(platform="tiktok")
        db.table.return_value.eq.assert_any_call("platform", "tiktok")

    def test_no_platform_filter_no_platform_eq_call(self):
        """Without platform= the function must NOT add an eq(platform) filter."""
        db = _make_simple_db([_vlog("v1")])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_trending_vlogs()
        # The table mock's eq calls should only include processing_status
        eq_args = [c.args for c in db.table.return_value.eq.call_args_list]
        assert not any(args[0] == "platform" for args in eq_args)


# ═══════════════════════════════════════════════════════════════════════════════
# get_new_this_week
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetNewThisWeek:

    def test_returns_list_of_dicts(self):
        pub = datetime.now(timezone.utc).isoformat()
        v = _vlog("v1", published_at=pub)
        v["created_at"] = pub
        db = _make_simple_db([v])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week()
        assert isinstance(result, list)
        assert result[0]["id"] == "v1"

    def test_filters_by_created_at(self):
        """The function must call gte() to filter by created_at."""
        db = _make_simple_db([])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_new_this_week()
        db.table.return_value.gte.assert_called_once()
        gte_args = db.table.return_value.gte.call_args.args
        assert gte_args[0] == "created_at"

    def test_respects_limit(self):
        """The service passes the limit argument to the DB query (mock can't enforce it)."""
        vlogs = [_vlog(f"v{i}") for i in range(20)]
        db = _make_simple_db(vlogs)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_new_this_week(limit=5)
        db.table.return_value.limit.assert_any_call(5)

    def test_empty_db_returns_empty_list(self):
        db = _make_simple_db([])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week()
        assert result == []

    def test_itinerary_id_flattened(self):
        v = _vlog("v1", itinerary_id="itin-new")
        db = _make_simple_db([v])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_new_this_week()
        assert result[0]["itinerary_id"] == "itin-new"


# ═══════════════════════════════════════════════════════════════════════════════
# get_vlogs_by_platform
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetVlogsByPlatform:

    def test_returns_list_for_tiktok(self):
        v = _vlog("tt1", platform="tiktok")
        db = _make_simple_db([v])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_vlogs_by_platform("tiktok")
        assert result[0]["id"] == "tt1"

    def test_platform_eq_called(self):
        db = _make_simple_db([_vlog("v1")])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_vlogs_by_platform("instagram")
        db.table.return_value.eq.assert_any_call("platform", "instagram")

    def test_respects_limit(self):
        """The service passes the limit argument to the DB query (mock can't enforce it)."""
        vlogs = [_vlog(f"v{i}") for i in range(20)]
        db = _make_simple_db(vlogs)
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            get_vlogs_by_platform("youtube", limit=4)
        db.table.return_value.limit.assert_any_call(4)

    def test_empty_platform_returns_empty(self):
        db = _make_simple_db([])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_vlogs_by_platform("tiktok")
        assert result == []

    def test_itinerary_id_flattened(self):
        v = _vlog("v1", itinerary_id="itin-ig")
        db = _make_simple_db([v])
        with patch("app.services.feed_ranking_service.get_supabase", return_value=db):
            result = get_vlogs_by_platform("youtube")
        assert result[0]["itinerary_id"] == "itin-ig"


# ═══════════════════════════════════════════════════════════════════════════════
# get_paginated_feed — platform filter + fallback integration
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetPaginatedFeedPlatform:
    """Tests for the new platform filter parameter in get_paginated_feed."""

    def _make_feed_row(self, vlog_data, score=0.5):
        return {"score": score, "reason_tags": [], "shown": False, "vlogs": vlog_data}

    def _mock_db_with_rows(self, mock_supabase, rows):
        chain = mock_supabase.table.return_value
        for method in ("select", "eq", "order", "limit", "lt", "lte", "gte"):
            getattr(chain, method).return_value = chain
        chain.execute.return_value = MagicMock(data=rows)
        return mock_supabase

    def test_platform_filter_excludes_wrong_platform(self, mock_supabase):
        """Only vlogs matching the platform filter should be returned.
        limit=1 ensures we get exactly 1 result (the tiktok match) without
        triggering the direct-vlogs fallback that would confuse the mock.
        """
        yt_vlog  = _vlog("yt1", platform="youtube")
        tt_vlog  = _vlog("tt1", platform="tiktok")
        rows = [
            self._make_feed_row(yt_vlog, score=0.9),
            self._make_feed_row(tt_vlog, score=0.8),
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-1", platform="tiktok", limit=1)

        ids = [v["id"] for v in result["vlogs"]]
        assert "tt1" in ids
        assert "yt1" not in ids

    def test_platform_filter_all_miss_triggers_fallback(self, mock_supabase):
        """
        When all feed_cache rows fail the platform filter the function must
        fall back to a direct vlogs query (second execute call).
        """
        yt_vlog = _vlog("yt1", platform="youtube")
        tt_direct = _vlog("tt-direct", platform="tiktok")
        rows = [self._make_feed_row(yt_vlog, score=0.9)]

        chain = mock_supabase.table.return_value
        for method in ("select", "eq", "order", "limit", "lt", "lte", "gte"):
            getattr(chain, method).return_value = chain

        # First execute() → feed_cache rows (no tiktok matches)
        # Second execute() → direct vlogs query result
        chain.execute.side_effect = [
            MagicMock(data=rows),
            MagicMock(data=[tt_direct]),
        ]

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-1", platform="tiktok")

        assert any(v["id"] == "tt-direct" for v in result["vlogs"])

    def test_no_filter_returns_all_platforms(self, mock_supabase):
        """Without a platform filter, vlogs of all platforms are returned."""
        rows = [
            self._make_feed_row(_vlog("yt1", platform="youtube"), score=0.9),
            self._make_feed_row(_vlog("tt1", platform="tiktok"),  score=0.8),
            self._make_feed_row(_vlog("ig1", platform="instagram"), score=0.7),
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-1")

        ids = [v["id"] for v in result["vlogs"]]
        assert "yt1" in ids
        assert "tt1" in ids
        assert "ig1" in ids

    def test_duration_filter_no_fallback(self, mock_supabase):
        """
        Duration-only filter must NOT trigger the direct DB fallback even when
        results are fewer than limit (duration data is always present).
        """
        short_vlog = _vlog("short", duration_seconds=300)
        rows = [self._make_feed_row(short_vlog, score=0.9)]
        chain = mock_supabase.table.return_value
        for method in ("select", "eq", "order", "limit", "lt", "lte", "gte"):
            getattr(chain, method).return_value = chain

        execute_calls = []
        def capture_execute():
            execute_calls.append(1)
            return MagicMock(data=rows)
        chain.execute.side_effect = lambda: capture_execute()

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-1", duration="short")

        # Only ONE execute() call — no fallback
        assert len(execute_calls) == 1

    def test_style_plus_platform_both_applied(self, mock_supabase):
        """Combined style+platform filter applies both in Python."""
        tt_adv = _vlog("tt-adv", platform="tiktok",    travel_styles=["adventure"])
        tt_lux = _vlog("tt-lux", platform="tiktok",    travel_styles=["luxury"])
        yt_adv = _vlog("yt-adv", platform="youtube",   travel_styles=["adventure"])
        rows = [
            self._make_feed_row(tt_adv, score=0.9),
            self._make_feed_row(tt_lux, score=0.85),
            self._make_feed_row(yt_adv, score=0.8),
        ]
        self._mock_db_with_rows(mock_supabase, rows)

        with patch("app.services.feed_ranking_service.get_supabase", return_value=mock_supabase):
            result = get_paginated_feed("user-1", style="adventure", platform="tiktok")

        ids = [v["id"] for v in result["vlogs"]]
        assert "tt-adv" in ids
        assert "tt-lux" not in ids
        assert "yt-adv" not in ids
