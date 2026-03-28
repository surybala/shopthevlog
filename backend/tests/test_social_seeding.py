"""
test_social_seeding.py
─────────────────────────────────────────────────────────────────────────────
Tests for the updated seeding logic in app/api/v1/social.py:
  - SEED_QUERIES format: each entry is a (query, destinations, travel_styles) tuple
  - _seed_public_travel_vlogs: inserts with proper tags, skips duplicates,
    handles YouTube API errors gracefully
  - _seed_for_user_interests: builds interest-targeted queries from user
    preferences, calls build_feed_for_user, limits query count, handles errors
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, AsyncMock, call
from datetime import datetime, timezone

from app.services.youtube_service import VlogMetadata
from app.api.v1.social import SEED_QUERIES, _seed_public_travel_vlogs, _seed_for_user_interests


# ─── Factories ────────────────────────────────────────────────────────────────

def _yt_vlog(video_id: str = "yt-001") -> VlogMetadata:
    return VlogMetadata(
        platform="youtube",
        platform_video_id=video_id,
        title=f"Test Vlog {video_id}",
        description="Great travel vlog",
        thumbnail_url="https://img.example.com/thumb.jpg",
        video_url=f"https://www.youtube.com/watch?v={video_id}",
        channel_name="Test Channel",
        channel_id="UCtest",
        duration_seconds=600,
        published_at=datetime.now(timezone.utc),
        view_count=10_000,
        like_count=500,
    )


def _make_db(exists: bool = False):
    """Return a mock Supabase where vlogs check returns exists/not-exists."""
    db = MagicMock()
    table = MagicMock()
    for m in ("select", "eq", "insert", "upsert", "update", "filter", "order", "limit"):
        getattr(table, m).return_value = table
    table.execute.return_value = MagicMock(data=[{"id": "existing-id"}] if exists else [])
    db.table.return_value = table
    return db, table


# ═══════════════════════════════════════════════════════════════════════════════
# SEED_QUERIES format validation
# ═══════════════════════════════════════════════════════════════════════════════

class TestSeedQueriesFormat:

    def test_seed_queries_is_a_non_empty_list(self):
        assert isinstance(SEED_QUERIES, list)
        assert len(SEED_QUERIES) > 0

    def test_every_entry_is_a_3_tuple(self):
        for entry in SEED_QUERIES:
            assert isinstance(entry, tuple), f"Expected tuple, got {type(entry)}: {entry}"
            assert len(entry) == 3, f"Expected 3 elements, got {len(entry)}: {entry}"

    def test_every_entry_has_string_query(self):
        for query, _, _ in SEED_QUERIES:
            assert isinstance(query, str) and len(query) > 0

    def test_every_entry_has_list_destinations(self):
        for _, destinations, _ in SEED_QUERIES:
            assert isinstance(destinations, list)

    def test_every_entry_has_list_travel_styles(self):
        for _, _, styles in SEED_QUERIES:
            assert isinstance(styles, list)

    def test_destinations_contain_only_strings(self):
        for _, destinations, _ in SEED_QUERIES:
            for d in destinations:
                assert isinstance(d, str), f"Non-string destination: {d!r}"

    def test_travel_styles_contain_only_strings(self):
        for _, _, styles in SEED_QUERIES:
            for s in styles:
                assert isinstance(s, str), f"Non-string style: {s!r}"

    def test_at_least_one_entry_has_destinations(self):
        """Some queries should have known destination tags (not all empty)."""
        has_destinations = any(len(dests) > 0 for _, dests, _ in SEED_QUERIES)
        assert has_destinations, "Expected at least one entry with destination tags"

    def test_at_least_one_entry_has_travel_styles(self):
        """Some queries should carry travel-style tags for the style filter."""
        has_styles = any(len(styles) > 0 for _, _, styles in SEED_QUERIES)
        assert has_styles, "Expected at least one entry with travel_styles tags"

    def test_no_duplicate_queries(self):
        queries = [q for q, _, _ in SEED_QUERIES]
        assert len(queries) == len(set(queries)), "Duplicate seed queries found"


# ═══════════════════════════════════════════════════════════════════════════════
# _seed_public_travel_vlogs
# ═══════════════════════════════════════════════════════════════════════════════

class TestSeedPublicTravelVlogs:

    @pytest.mark.asyncio
    async def test_inserts_vlogs_with_destination_tags(self):
        """Each newly found vlog gets the destinations from its query tuple."""
        db, table = _make_db(exists=False)
        vlog = _yt_vlog("yt-japan-01")

        # Only run the first SEED_QUERIES entry to keep the test focused
        first_entry = SEED_QUERIES[0]
        first_query, first_dests, first_styles = first_entry

        with patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]):
            # Patch SEED_QUERIES to just the first entry so we control the payload
            with patch("app.api.v1.social.SEED_QUERIES", [first_entry]):
                await _seed_public_travel_vlogs(db)

        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        payload = insert_calls[0][0][0]
        assert payload["destinations"] == first_dests
        assert payload["travel_styles"] == first_styles

    @pytest.mark.asyncio
    async def test_inserts_vlogs_with_travel_style_tags(self):
        """Inserted vlogs carry the travel_styles from the seed query entry."""
        db, table = _make_db(exists=False)
        vlog = _yt_vlog("yt-luxury-01")
        style_entry = ("luxury resort travel vlog", [], ["luxury"])

        with patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.SEED_QUERIES", [style_entry]):
            await _seed_public_travel_vlogs(db)

        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        payload = insert_calls[0][0][0]
        assert "luxury" in payload["travel_styles"]

    @pytest.mark.asyncio
    async def test_skips_already_existing_vlogs(self):
        """If platform_video_id already exists in DB, insert must not be called."""
        db, table = _make_db(exists=True)
        vlog = _yt_vlog("already-exists")

        with patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.SEED_QUERIES", [("test query", [], [])]):
            inserted = await _seed_public_travel_vlogs(db)

        table.insert.assert_not_called()
        assert inserted == 0

    @pytest.mark.asyncio
    async def test_returns_count_of_inserted_vlogs(self):
        db, _ = _make_db(exists=False)
        vlogs = [_yt_vlog(f"yt-{i:03d}") for i in range(3)]

        with patch("app.api.v1.social.search_travel_vlogs", return_value=vlogs), \
             patch("app.api.v1.social.SEED_QUERIES", [("query", ["Japan"], ["cultural"])]):
            count = await _seed_public_travel_vlogs(db)

        assert count == 3

    @pytest.mark.asyncio
    async def test_youtube_error_on_one_query_does_not_abort_others(self):
        """If one seed query fails, remaining queries still run."""
        db, table = _make_db(exists=False)
        good_vlog = _yt_vlog("yt-good")

        call_count = 0
        def yt_side_effect(query, max_results=20):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("YouTube quota exceeded")
            return [good_vlog]

        two_queries = [
            ("failing query", [], []),
            ("succeeding query", [], []),
        ]
        with patch("app.api.v1.social.search_travel_vlogs", side_effect=yt_side_effect), \
             patch("app.api.v1.social.SEED_QUERIES", two_queries):
            count = await _seed_public_travel_vlogs(db)

        assert count == 1  # only the second query succeeded

    @pytest.mark.asyncio
    async def test_vlogs_marked_ready_immediately(self):
        """Seeded vlogs must be ready=True so ranking picks them up without waiting for AI."""
        db, table = _make_db(exists=False)
        vlog = _yt_vlog("yt-ready-01")

        with patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.SEED_QUERIES", [("query", [], [])]):
            await _seed_public_travel_vlogs(db)

        payload = table.insert.call_args[0][0]
        assert payload["processing_status"] == "ready"


# ═══════════════════════════════════════════════════════════════════════════════
# _seed_for_user_interests
# ═══════════════════════════════════════════════════════════════════════════════

class TestSeedForUserInterests:

    def _make_interest_db(self):
        db = MagicMock()
        table = MagicMock()
        for m in ("select", "eq", "insert", "upsert", "update", "filter", "limit", "order"):
            getattr(table, m).return_value = table
        table.execute.return_value = MagicMock(data=[])
        db.table.return_value = table
        return db, table

    @pytest.mark.asyncio
    async def test_builds_one_query_per_travel_style(self):
        db, _ = self._make_interest_db()
        yt_calls = []

        def capture(query, max_results=10):
            yt_calls.append(query)
            return []

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", side_effect=capture), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", ["adventure", "luxury"], [])

        # Each style generates one YouTube search
        assert any("adventure" in q for q in yt_calls)
        assert any("luxury" in q for q in yt_calls)

    @pytest.mark.asyncio
    async def test_builds_one_query_per_destination(self):
        db, _ = self._make_interest_db()
        yt_calls = []

        def capture(query, max_results=10):
            yt_calls.append(query)
            return []

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", side_effect=capture), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", [], ["Japan", "Italy"])

        assert any("Japan" in q for q in yt_calls)
        assert any("Italy" in q for q in yt_calls)

    @pytest.mark.asyncio
    async def test_style_queries_tag_vlog_with_style(self):
        """Vlogs seeded from a style query should carry that style in travel_styles."""
        db, table = self._make_interest_db()
        vlog = _yt_vlog("yt-adv-01")

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", ["adventure"], [])

        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        payload = insert_calls[0][0][0]
        assert "adventure" in payload["travel_styles"]

    @pytest.mark.asyncio
    async def test_destination_queries_tag_vlog_with_destination(self):
        """Vlogs seeded from a destination query should carry that destination."""
        db, table = self._make_interest_db()
        vlog = _yt_vlog("yt-jp-01")

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", [], ["Japan"])

        insert_calls = table.insert.call_args_list
        assert len(insert_calls) > 0
        payload = insert_calls[0][0][0]
        assert "Japan" in payload["destinations"]

    @pytest.mark.asyncio
    async def test_calls_build_feed_for_user_at_end(self):
        """After seeding, build_feed_for_user must be called exactly once."""
        db, _ = self._make_interest_db()
        build_mock = MagicMock()

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", return_value=[]), \
             patch("app.api.v1.social.build_feed_for_user", build_mock):
            await _seed_for_user_interests("user-xyz", ["beach"], ["Bali"])

        build_mock.assert_called_once_with("user-xyz")

    @pytest.mark.asyncio
    async def test_limits_to_six_styles(self):
        """Only first 6 travel styles should generate search queries."""
        db, _ = self._make_interest_db()
        yt_calls = []

        def capture(query, max_results=10):
            yt_calls.append(query)
            return []

        styles = ["adventure", "luxury", "budget", "solo", "family", "backpacking", "cultural"]
        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", side_effect=capture), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", styles, [])

        # 7 styles → only 6 queries (the 7th "cultural" is dropped)
        style_queries = [q for q in yt_calls if "travel vlog" in q]
        assert len(style_queries) == 6
        assert not any("cultural" in q for q in style_queries)

    @pytest.mark.asyncio
    async def test_limits_to_four_destinations(self):
        """Only first 4 destinations should generate search queries."""
        db, _ = self._make_interest_db()
        yt_calls = []

        def capture(query, max_results=10):
            yt_calls.append(query)
            return []

        dests = ["Japan", "Italy", "Morocco", "Thailand", "France"]
        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", side_effect=capture), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", [], dests)

        dest_queries = [q for q in yt_calls]
        assert len(dest_queries) == 4
        assert not any("France" in q for q in dest_queries)

    @pytest.mark.asyncio
    async def test_youtube_error_on_one_interest_does_not_abort(self):
        """A failure on one interest query should not prevent others from running."""
        db, table = self._make_interest_db()
        call_count = 0

        def yt_side_effect(query, max_results=10):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("Quota exceeded")
            return [_yt_vlog(f"yt-{call_count:03d}")]

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", side_effect=yt_side_effect), \
             patch("app.api.v1.social.build_feed_for_user"):
            # Should not raise
            await _seed_for_user_interests("user-1", ["adventure", "luxury"], [])

        # Second query succeeded and should have inserted
        assert table.insert.called

    @pytest.mark.asyncio
    async def test_empty_styles_and_destinations_still_calls_build_feed(self):
        """Even with no interests, build_feed_for_user should still be called."""
        db, _ = self._make_interest_db()
        build_mock = MagicMock()

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", return_value=[]), \
             patch("app.api.v1.social.build_feed_for_user", build_mock):
            await _seed_for_user_interests("user-1", [], [])

        build_mock.assert_called_once_with("user-1")

    @pytest.mark.asyncio
    async def test_skips_already_existing_vlogs(self):
        """Vlogs whose platform_video_id already exists in DB are not re-inserted."""
        db, table = self._make_interest_db()
        # Make the exists check return True
        table.execute.return_value = MagicMock(data=[{"id": "existing"}])
        vlog = _yt_vlog("already-exists")

        with patch("app.api.v1.social.get_supabase", return_value=db), \
             patch("app.api.v1.social.search_travel_vlogs", return_value=[vlog]), \
             patch("app.api.v1.social.build_feed_for_user"):
            await _seed_for_user_interests("user-1", ["beach"], [])

        table.insert.assert_not_called()
