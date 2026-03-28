"""
test_tiktok_service.py
─────────────────────────────────────────────────────────────────────────────
Tests for app/services/tiktok_service.py:

  - TIKTOK_SEED_HASHTAGS  — format and uniqueness validation
  - tiktok_raw_to_payload — converts raw yt-dlp JSON to vlog insert payload
  - seed_tiktok_travel_content — inserts new TikTok vlogs, skips duplicates,
                                  handles errors gracefully, returns count
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

from app.services.tiktok_service import (
    TIKTOK_SEED_HASHTAGS,
    tiktok_raw_to_payload,
    seed_tiktok_travel_content,
)


# ─── Factories ────────────────────────────────────────────────────────────────

def _raw_tiktok(
    video_id="tt-001",
    title="Amazing Travel TikTok",
    description="Travel is life #travel",
    uploader="@travelcreator",
    uploader_id="creator123",
    duration=30,
    view_count=150_000,
    like_count=8_000,
    timestamp=1_700_000_000,
    thumbnail="https://tiktok-cdn.example.com/thumb.jpg",
):
    return {
        "id": video_id,
        "title": title,
        "description": description,
        "uploader": uploader,
        "uploader_id": uploader_id,
        "duration": duration,
        "view_count": view_count,
        "like_count": like_count,
        "timestamp": timestamp,
        "thumbnail": thumbnail,
        "webpage_url": f"https://www.tiktok.com/@{uploader}/video/{video_id}",
    }


def _make_db(exists: bool = False):
    db = MagicMock()
    table = MagicMock()
    for m in ("select", "eq", "insert", "upsert", "update", "filter", "order", "limit"):
        getattr(table, m).return_value = table
    table.execute.return_value = MagicMock(data=[{"id": "existing"}] if exists else [])
    db.table.return_value = table
    return db, table


# ═══════════════════════════════════════════════════════════════════════════════
# TIKTOK_SEED_HASHTAGS format
# ═══════════════════════════════════════════════════════════════════════════════

class TestTiktokSeedHashtags:

    def test_is_non_empty_list(self):
        assert isinstance(TIKTOK_SEED_HASHTAGS, list)
        assert len(TIKTOK_SEED_HASHTAGS) > 0

    def test_every_entry_is_3_tuple(self):
        for entry in TIKTOK_SEED_HASHTAGS:
            assert isinstance(entry, tuple), f"Expected tuple, got {type(entry)}"
            assert len(entry) == 3, f"Expected 3 elements, got {len(entry)}"

    def test_hashtag_is_non_empty_string(self):
        for hashtag, _, _ in TIKTOK_SEED_HASHTAGS:
            assert isinstance(hashtag, str) and len(hashtag) > 0

    def test_hashtag_does_not_start_with_hash(self):
        """yt-dlp takes the bare hashtag name, not the # symbol."""
        for hashtag, _, _ in TIKTOK_SEED_HASHTAGS:
            assert not hashtag.startswith("#"), f"Hashtag '{hashtag}' should not start with #"

    def test_travel_styles_are_lists_of_strings(self):
        for _, styles, _ in TIKTOK_SEED_HASHTAGS:
            assert isinstance(styles, list)
            for s in styles:
                assert isinstance(s, str)

    def test_destinations_are_lists_of_strings(self):
        for _, _, dests in TIKTOK_SEED_HASHTAGS:
            assert isinstance(dests, list)
            for d in dests:
                assert isinstance(d, str)

    def test_at_least_one_entry_has_travel_styles(self):
        assert any(len(styles) > 0 for _, styles, _ in TIKTOK_SEED_HASHTAGS)

    def test_no_duplicate_hashtags(self):
        hashtags = [h for h, _, _ in TIKTOK_SEED_HASHTAGS]
        assert len(hashtags) == len(set(hashtags)), "Duplicate hashtags found"

    def test_hashtags_cover_diverse_styles(self):
        """Expect at least adventure, luxury, and solo travel to be covered."""
        all_styles = {s for _, styles, _ in TIKTOK_SEED_HASHTAGS for s in styles}
        assert "adventure" in all_styles
        assert "luxury" in all_styles


# ═══════════════════════════════════════════════════════════════════════════════
# tiktok_raw_to_payload
# ═══════════════════════════════════════════════════════════════════════════════

class TestTiktokRawToPayload:

    def test_returns_dict_for_valid_raw(self):
        raw = _raw_tiktok()
        result = tiktok_raw_to_payload(raw)
        assert result is not None
        assert isinstance(result, dict)

    def test_platform_is_tiktok(self):
        result = tiktok_raw_to_payload(_raw_tiktok())
        assert result["platform"] == "tiktok"

    def test_video_id_from_id_field(self):
        raw = _raw_tiktok(video_id="abc123")
        result = tiktok_raw_to_payload(raw)
        assert result["platform_video_id"] == "abc123"

    def test_video_id_from_display_id_fallback(self):
        raw = {"display_id": "disp-456", "title": "Test"}
        result = tiktok_raw_to_payload(raw)
        assert result is not None
        assert result["platform_video_id"] == "disp-456"

    def test_video_id_from_webpage_url_basename_fallback(self):
        raw = {"webpage_url_basename": "url-789", "title": "Test"}
        result = tiktok_raw_to_payload(raw)
        assert result is not None
        assert result["platform_video_id"] == "url-789"

    def test_returns_none_when_no_video_id(self):
        raw = {"title": "Some TikTok", "description": "No ID here"}
        result = tiktok_raw_to_payload(raw)
        assert result is None

    def test_title_truncated_to_500_chars(self):
        long_title = "A" * 600
        raw = _raw_tiktok(title=long_title)
        result = tiktok_raw_to_payload(raw)
        assert len(result["title"]) <= 500

    def test_description_truncated_to_2000_chars(self):
        long_desc = "B" * 2500
        raw = _raw_tiktok(description=long_desc)
        result = tiktok_raw_to_payload(raw)
        assert len(result["description"]) <= 2000

    def test_processing_status_is_ready(self):
        result = tiktok_raw_to_payload(_raw_tiktok())
        assert result["processing_status"] == "ready"

    def test_timestamp_parsed_to_iso(self):
        raw = _raw_tiktok(timestamp=1_700_000_000)
        result = tiktok_raw_to_payload(raw)
        assert result["published_at"] is not None
        # Should parse as an ISO-format datetime string
        dt = datetime.fromisoformat(result["published_at"].replace("Z", "+00:00"))
        assert dt.year == 2023  # 1700000000 ≈ Nov 2023

    def test_none_timestamp_gives_none_published_at(self):
        raw = _raw_tiktok()
        raw["timestamp"] = None
        result = tiktok_raw_to_payload(raw)
        assert result["published_at"] is None

    def test_thumbnail_from_thumbnail_field(self):
        raw = _raw_tiktok(thumbnail="https://cdn.example.com/t.jpg")
        result = tiktok_raw_to_payload(raw)
        assert result["thumbnail_url"] == "https://cdn.example.com/t.jpg"

    def test_thumbnail_fallback_from_thumbnails_list(self):
        raw = _raw_tiktok()
        del raw["thumbnail"]
        raw["thumbnails"] = [{"url": "https://cdn.example.com/first.jpg"}]
        result = tiktok_raw_to_payload(raw)
        assert result["thumbnail_url"] == "https://cdn.example.com/first.jpg"

    def test_none_view_count_accepted(self):
        raw = _raw_tiktok(view_count=None)
        result = tiktok_raw_to_payload(raw)
        assert result["view_count"] is None

    def test_none_like_count_accepted(self):
        raw = _raw_tiktok(like_count=None)
        result = tiktok_raw_to_payload(raw)
        assert result["like_count"] is None

    def test_none_duration_accepted(self):
        raw = _raw_tiktok(duration=None)
        result = tiktok_raw_to_payload(raw)
        assert result["duration_seconds"] is None

    def test_travel_styles_set(self):
        raw = _raw_tiktok()
        result = tiktok_raw_to_payload(raw, travel_styles=["adventure", "beach"])
        assert result["travel_styles"] == ["adventure", "beach"]

    def test_destinations_set(self):
        raw = _raw_tiktok()
        result = tiktok_raw_to_payload(raw, destinations=["Bali", "Indonesia"])
        assert result["destinations"] == ["Bali", "Indonesia"]

    def test_empty_styles_and_dests_when_not_provided(self):
        result = tiktok_raw_to_payload(_raw_tiktok())
        assert result["travel_styles"] == []
        assert result["destinations"] == []

    def test_channel_name_from_uploader(self):
        raw = _raw_tiktok(uploader="@wanderlust_creator")
        result = tiktok_raw_to_payload(raw)
        assert result["channel_name"] == "@wanderlust_creator"

    def test_channel_id_from_uploader_id(self):
        raw = _raw_tiktok(uploader_id="uid-999")
        result = tiktok_raw_to_payload(raw)
        assert result["channel_id"] == "uid-999"

    def test_video_url_set(self):
        raw = _raw_tiktok(video_id="vid123")
        result = tiktok_raw_to_payload(raw)
        assert result["video_url"] is not None
        assert "tiktok.com" in result["video_url"] or "vid123" in result["video_url"]

    def test_raw_transcript_is_description_or_title(self):
        raw = _raw_tiktok(description="travel description")
        result = tiktok_raw_to_payload(raw)
        assert result["raw_transcript"] == "travel description"

    def test_raw_transcript_falls_back_to_title(self):
        raw = _raw_tiktok()
        raw["description"] = ""
        raw["title"] = "My Travel Title"
        result = tiktok_raw_to_payload(raw)
        assert result["raw_transcript"] == "My Travel Title"


# ═══════════════════════════════════════════════════════════════════════════════
# seed_tiktok_travel_content
# ═══════════════════════════════════════════════════════════════════════════════

class TestSeedTiktokTravelContent:

    def test_inserts_new_vlog_and_returns_count(self):
        db, table = _make_db(exists=False)
        raw = _raw_tiktok("tt-new")

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS",
                   [("traveltiktok", ["adventure"], [])]):
            count = seed_tiktok_travel_content(db, max_per_hashtag=5)

        assert count == 1
        table.insert.assert_called_once()

    def test_skips_existing_vlog(self):
        db, table = _make_db(exists=True)
        raw = _raw_tiktok("tt-existing")

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS",
                   [("traveltiktok", [], [])]):
            count = seed_tiktok_travel_content(db, max_per_hashtag=5)

        table.insert.assert_not_called()
        assert count == 0

    def test_inserts_with_correct_travel_styles(self):
        db, table = _make_db(exists=False)
        raw = _raw_tiktok("tt-luxury")

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS",
                   [("luxurytravel", ["luxury"], [])]):
            seed_tiktok_travel_content(db, max_per_hashtag=5)

        payload = table.insert.call_args[0][0]
        assert "luxury" in payload["travel_styles"]

    def test_inserts_with_correct_destinations(self):
        db, table = _make_db(exists=False)
        raw = _raw_tiktok("tt-japan")

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS",
                   [("japantravel", [], ["Japan"])]):
            seed_tiktok_travel_content(db, max_per_hashtag=5)

        payload = table.insert.call_args[0][0]
        assert "Japan" in payload["destinations"]

    def test_platform_set_to_tiktok(self):
        db, table = _make_db(exists=False)
        raw = _raw_tiktok()

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", [("travel", [], [])]):
            seed_tiktok_travel_content(db, max_per_hashtag=5)

        payload = table.insert.call_args[0][0]
        assert payload["platform"] == "tiktok"

    def test_yt_dlp_error_on_one_hashtag_does_not_abort(self):
        """If one hashtag fails, remaining hashtags still run."""
        db, table = _make_db(exists=False)
        good_raw = _raw_tiktok("tt-good")

        call_count = 0
        def side_effect(hashtag, max_results=10):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("yt-dlp error")
            return [good_raw]

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", side_effect=side_effect), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS",
                   [("failing", [], []), ("working", ["adventure"], [])]):
            count = seed_tiktok_travel_content(db, max_per_hashtag=5)

        assert count == 1

    def test_invalid_payload_skipped(self):
        """Raws without a video ID produce None payloads and must be skipped."""
        db, table = _make_db(exists=False)
        bad_raw = {"title": "No ID anywhere"}  # missing id, display_id, etc.

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[bad_raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", [("travel", [], [])]):
            count = seed_tiktok_travel_content(db, max_per_hashtag=5)

        table.insert.assert_not_called()
        assert count == 0

    def test_multiple_hashtags_all_processed(self):
        """All hashtags in the seed list are queried."""
        db, table = _make_db(exists=False)
        called_with: list[str] = []

        def capture(hashtag, max_results=10):
            called_with.append(hashtag)
            return []

        hashtags = [("adventure", [], []), ("luxury", [], []), ("solo", [], [])]
        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", side_effect=capture), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", hashtags):
            seed_tiktok_travel_content(db, max_per_hashtag=5)

        assert "adventure" in called_with
        assert "luxury" in called_with
        assert "solo" in called_with

    def test_max_per_hashtag_passed_to_search(self):
        """max_per_hashtag must be forwarded to search_tiktok_by_hashtag."""
        db, _ = _make_db(exists=False)
        captured_max = []

        def capture(hashtag, max_results=10):
            captured_max.append(max_results)
            return []

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", side_effect=capture), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", [("travel", [], [])]):
            seed_tiktok_travel_content(db, max_per_hashtag=12)

        assert captured_max[0] == 12

    def test_processing_status_ready(self):
        db, table = _make_db(exists=False)
        raw = _raw_tiktok()

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=[raw]), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", [("travel", [], [])]):
            seed_tiktok_travel_content(db, max_per_hashtag=5)

        payload = table.insert.call_args[0][0]
        assert payload["processing_status"] == "ready"

    def test_multiple_videos_per_hashtag_all_inserted(self):
        db, table = _make_db(exists=False)
        raws = [_raw_tiktok(f"tt-{i}") for i in range(3)]

        with patch("app.services.tiktok_service.search_tiktok_by_hashtag", return_value=raws), \
             patch("app.services.tiktok_service.TIKTOK_SEED_HASHTAGS", [("travel", [], [])]):
            count = seed_tiktok_travel_content(db, max_per_hashtag=5)

        assert count == 3
        assert table.insert.call_count == 3
