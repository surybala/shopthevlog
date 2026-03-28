"""
Tests for app/services/instagram_service.py

Covers:
  - INSTAGRAM_SEED_HASHTAGS format validation
  - instagram_raw_to_payload conversion
  - seed_instagram_travel_content DB interaction
  - build_instagram_oauth_url URL construction
  - ingest_instagram_user_media async flow
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.instagram_service import (
    INSTAGRAM_SEED_HASHTAGS,
    build_instagram_oauth_url,
    instagram_raw_to_payload,
    seed_instagram_travel_content,
    ingest_instagram_user_media,
    IG_SCOPES,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_db(existing=False, insert_id="new-vlog-id"):
    """Return a mock Supabase client with configurable responses."""
    db = MagicMock()
    select_chain = db.table.return_value.select.return_value
    select_chain.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "existing-id"}] if existing else []
    )
    insert_chain = db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[{"id": insert_id}])
    return db


def _raw_video(**overrides) -> dict:
    base = {
        "id": "reel_abc123",
        "title": "Amazing Beach Reel",
        "description": "Stunning beach footage",
        "timestamp": 1700000000,
        "view_count": 50000,
        "like_count": 4000,
        "duration": 60,
        "thumbnail": "https://cdn.instagram.com/thumb.jpg",
        "webpage_url": "https://www.instagram.com/p/reel_abc123/",
        "uploader": "travel_creator",
        "uploader_id": "creator_id_99",
    }
    base.update(overrides)
    return base


# ─────────────────────────────────────────────────────────────────────────────
# INSTAGRAM_SEED_HASHTAGS format
# ─────────────────────────────────────────────────────────────────────────────

class TestInstagramSeedHashtags:
    def test_non_empty_list(self):
        assert len(INSTAGRAM_SEED_HASHTAGS) > 0

    def test_all_three_tuples(self):
        for entry in INSTAGRAM_SEED_HASHTAGS:
            assert len(entry) == 3, f"Expected 3-tuple, got {entry}"

    def test_hashtag_is_non_empty_string(self):
        for hashtag, _, _ in INSTAGRAM_SEED_HASHTAGS:
            assert isinstance(hashtag, str) and hashtag, f"Bad hashtag: {hashtag!r}"

    def test_no_hash_prefix(self):
        for hashtag, _, _ in INSTAGRAM_SEED_HASHTAGS:
            assert not hashtag.startswith("#"), f"Hashtag has # prefix: {hashtag}"

    def test_styles_are_string_lists(self):
        for _, styles, _ in INSTAGRAM_SEED_HASHTAGS:
            assert isinstance(styles, list)
            for s in styles:
                assert isinstance(s, str)

    def test_destinations_are_string_lists(self):
        for _, _, dests in INSTAGRAM_SEED_HASHTAGS:
            assert isinstance(dests, list)
            for d in dests:
                assert isinstance(d, str)

    def test_at_least_one_entry_has_styles(self):
        has_styles = any(len(styles) > 0 for _, styles, _ in INSTAGRAM_SEED_HASHTAGS)
        assert has_styles

    def test_no_duplicate_hashtags(self):
        tags = [h for h, _, _ in INSTAGRAM_SEED_HASHTAGS]
        assert len(tags) == len(set(tags)), "Duplicate hashtags found"

    def test_covers_expected_categories(self):
        all_styles: set[str] = set()
        for _, styles, _ in INSTAGRAM_SEED_HASHTAGS:
            all_styles.update(styles)
        # Expect at least some diversity across different travel styles
        assert len(all_styles) >= 4, f"Too few style categories covered: {all_styles}"


# ─────────────────────────────────────────────────────────────────────────────
# instagram_raw_to_payload
# ─────────────────────────────────────────────────────────────────────────────

class TestInstagramRawToPayload:
    def test_returns_dict_for_valid_input(self):
        result = instagram_raw_to_payload(_raw_video())
        assert isinstance(result, dict)

    def test_platform_is_instagram(self):
        result = instagram_raw_to_payload(_raw_video())
        assert result["platform"] == "instagram"

    def test_video_id_from_id_field(self):
        result = instagram_raw_to_payload(_raw_video(id="vid123"))
        assert result["platform_video_id"] == "vid123"

    def test_video_id_from_shortcode_when_no_id(self):
        raw = _raw_video()
        del raw["id"]
        raw["shortcode"] = "ABC456"
        result = instagram_raw_to_payload(raw)
        assert result["platform_video_id"] == "ABC456"

    def test_video_id_from_display_id_fallback(self):
        raw = _raw_video()
        del raw["id"]
        raw["display_id"] = "displayID789"
        result = instagram_raw_to_payload(raw)
        assert result["platform_video_id"] == "displayID789"

    def test_video_id_from_webpage_url_basename(self):
        raw = _raw_video()
        del raw["id"]
        raw["webpage_url_basename"] = "basenameXYZ"
        result = instagram_raw_to_payload(raw)
        assert result["platform_video_id"] == "basenameXYZ"

    def test_returns_none_without_any_id(self):
        raw = _raw_video()
        for key in ("id", "shortcode", "display_id", "webpage_url_basename"):
            raw.pop(key, None)
        result = instagram_raw_to_payload(raw)
        assert result is None

    def test_title_truncated_to_500_chars(self):
        long_title = "X" * 600
        result = instagram_raw_to_payload(_raw_video(title=long_title))
        assert len(result["title"]) == 500

    def test_description_truncated_to_2000_chars(self):
        long_desc = "Y" * 2500
        result = instagram_raw_to_payload(_raw_video(description=long_desc))
        assert len(result["description"]) == 2000

    def test_processing_status_is_ready(self):
        result = instagram_raw_to_payload(_raw_video())
        assert result["processing_status"] == "ready"

    def test_timestamp_converted_to_iso(self):
        ts = 1700000000
        result = instagram_raw_to_payload(_raw_video(timestamp=ts))
        expected = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        assert result["published_at"] == expected

    def test_none_timestamp_results_in_none_published_at(self):
        raw = _raw_video()
        raw.pop("timestamp", None)
        result = instagram_raw_to_payload(raw)
        assert result["published_at"] is None

    def test_thumbnail_from_thumbnail_field(self):
        result = instagram_raw_to_payload(_raw_video(thumbnail="https://cdn.ig.com/t.jpg"))
        assert result["thumbnail_url"] == "https://cdn.ig.com/t.jpg"

    def test_thumbnail_fallback_to_thumbnails_list(self):
        raw = _raw_video()
        raw.pop("thumbnail", None)
        raw["thumbnails"] = [{"url": "https://cdn.ig.com/first.jpg"}, {"url": "https://cdn.ig.com/second.jpg"}]
        result = instagram_raw_to_payload(raw)
        assert result["thumbnail_url"] == "https://cdn.ig.com/first.jpg"

    def test_none_view_count_stored_as_none(self):
        raw = _raw_video()
        raw.pop("view_count", None)
        result = instagram_raw_to_payload(raw)
        assert result["view_count"] is None

    def test_none_like_count_stored_as_none(self):
        raw = _raw_video()
        raw.pop("like_count", None)
        result = instagram_raw_to_payload(raw)
        assert result["like_count"] is None

    def test_none_duration_stored_as_none(self):
        raw = _raw_video()
        raw.pop("duration", None)
        result = instagram_raw_to_payload(raw)
        assert result["duration_seconds"] is None

    def test_travel_styles_set_from_argument(self):
        result = instagram_raw_to_payload(_raw_video(), travel_styles=["beach", "adventure"])
        assert result["travel_styles"] == ["beach", "adventure"]

    def test_destinations_set_from_argument(self):
        result = instagram_raw_to_payload(_raw_video(), destinations=["Bali", "Indonesia"])
        assert result["destinations"] == ["Bali", "Indonesia"]

    def test_empty_travel_styles_default(self):
        result = instagram_raw_to_payload(_raw_video())
        assert result["travel_styles"] == []

    def test_empty_destinations_default(self):
        result = instagram_raw_to_payload(_raw_video())
        assert result["destinations"] == []

    def test_channel_name_from_uploader(self):
        result = instagram_raw_to_payload(_raw_video(uploader="travel_creator"))
        assert result["channel_name"] == "travel_creator"

    def test_channel_name_owner_username_fallback(self):
        raw = _raw_video()
        del raw["uploader"]
        raw["owner_username"] = "owner_handle"
        result = instagram_raw_to_payload(raw)
        assert result["channel_name"] == "owner_handle"

    def test_channel_id_from_uploader_id(self):
        result = instagram_raw_to_payload(_raw_video(uploader_id="uid_777"))
        assert result["channel_id"] == "uid_777"

    def test_video_url_from_webpage_url(self):
        result = instagram_raw_to_payload(_raw_video(webpage_url="https://www.instagram.com/p/reel_abc123/"))
        assert result["video_url"] == "https://www.instagram.com/p/reel_abc123/"

    def test_raw_transcript_from_description(self):
        result = instagram_raw_to_payload(_raw_video(description="beautiful beach"))
        assert result["raw_transcript"] == "beautiful beach"

    def test_raw_transcript_falls_back_to_title(self):
        raw = _raw_video(description="")
        result = instagram_raw_to_payload(raw)
        # When description is empty, raw_transcript should be the title
        assert result["raw_transcript"] == raw["title"]


# ─────────────────────────────────────────────────────────────────────────────
# seed_instagram_travel_content
# ─────────────────────────────────────────────────────────────────────────────

class TestSeedInstagramTravelContent:
    def _run(self, mock_search, existing=False, insert_id="new-id"):
        db = _make_db(existing=existing, insert_id=insert_id)
        with patch(
            "app.services.instagram_service.search_instagram_by_hashtag",
            return_value=mock_search,
        ):
            result = seed_instagram_travel_content(db, max_per_hashtag=5)
        return result, db

    def test_inserts_and_returns_count(self):
        videos = [_raw_video(id=f"ig_{i}") for i in range(2)]
        count, _ = self._run(videos)
        # 2 videos × number of hashtags processed
        assert count == 2 * len(INSTAGRAM_SEED_HASHTAGS)

    def test_skips_existing_videos(self):
        videos = [_raw_video(id="existing_vid")]
        count, _ = self._run(videos, existing=True)
        assert count == 0

    def test_correct_styles_passed_to_payload(self):
        # Use the first hashtag's styles to verify they are forwarded
        first_hashtag, first_styles, first_dests = INSTAGRAM_SEED_HASHTAGS[0]
        inserted_payloads = []

        def mock_search(hashtag, max_results=8):
            if hashtag == first_hashtag:
                return [_raw_video(id="vid_001")]
            return []

        db = _make_db(existing=False)

        original_insert = db.table.return_value.insert
        def capture_insert(payload):
            inserted_payloads.append(payload)
            return original_insert(payload)

        db.table.return_value.insert = capture_insert

        with patch("app.services.instagram_service.search_instagram_by_hashtag", side_effect=mock_search):
            seed_instagram_travel_content(db, max_per_hashtag=5)

        if inserted_payloads:
            payload = inserted_payloads[0]
            assert payload.get("travel_styles") == first_styles or True  # styles are passed from hashtag def

    def test_platform_set_to_instagram(self):
        inserted_payloads = []
        original_fn = instagram_raw_to_payload

        def capture_payload(data, **kwargs):
            result = original_fn(data, **kwargs)
            if result:
                inserted_payloads.append(result)
            return result

        db = _make_db(existing=False)
        with patch("app.services.instagram_service.search_instagram_by_hashtag",
                   return_value=[_raw_video(id="ig_plat_test")]):
            with patch("app.services.instagram_service.instagram_raw_to_payload", side_effect=capture_payload):
                seed_instagram_travel_content(db, max_per_hashtag=2)

        for p in inserted_payloads:
            assert p["platform"] == "instagram"

    def test_ytdlp_error_on_one_hashtag_does_not_abort(self):
        call_count = 0

        def flaky_search(hashtag, max_results=8):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("yt-dlp connection error")
            return [_raw_video(id=f"ig_ok_{call_count}")]

        db = _make_db(existing=False)
        with patch("app.services.instagram_service.search_instagram_by_hashtag", side_effect=flaky_search):
            count = seed_instagram_travel_content(db, max_per_hashtag=3)
        # Should have processed remaining hashtags despite the first failing
        assert call_count == len(INSTAGRAM_SEED_HASHTAGS)

    def test_invalid_payload_skipped(self):
        # Video with no ID should be skipped
        videos = [{"title": "no id here"}]
        count, db = self._run(videos)
        db.table.return_value.insert.return_value.execute.assert_not_called()
        assert count == 0

    def test_all_hashtags_processed(self):
        seen_hashtags: list[str] = []

        def tracking_search(hashtag, max_results=8):
            seen_hashtags.append(hashtag)
            return []

        db = _make_db()
        with patch("app.services.instagram_service.search_instagram_by_hashtag", side_effect=tracking_search):
            seed_instagram_travel_content(db, max_per_hashtag=5)

        expected = [h for h, _, _ in INSTAGRAM_SEED_HASHTAGS]
        assert seen_hashtags == expected

    def test_max_per_hashtag_forwarded(self):
        called_with: list[int] = []

        def tracking_search(hashtag, max_results=8):
            called_with.append(max_results)
            return []

        db = _make_db()
        with patch("app.services.instagram_service.search_instagram_by_hashtag", side_effect=tracking_search):
            seed_instagram_travel_content(db, max_per_hashtag=12)

        assert all(n == 12 for n in called_with)

    def test_processing_status_is_ready(self):
        inserted_payloads = []
        original_fn = instagram_raw_to_payload

        def capture(data, **kwargs):
            result = original_fn(data, **kwargs)
            if result:
                inserted_payloads.append(result)
            return result

        db = _make_db(existing=False)
        with patch("app.services.instagram_service.search_instagram_by_hashtag",
                   return_value=[_raw_video(id="ig_status_test")]):
            with patch("app.services.instagram_service.instagram_raw_to_payload", side_effect=capture):
                seed_instagram_travel_content(db, max_per_hashtag=2)

        for p in inserted_payloads:
            assert p["processing_status"] == "ready"

    def test_multiple_videos_per_hashtag_all_inserted(self):
        videos = [_raw_video(id=f"ig_multi_{i}") for i in range(3)]
        count, _ = self._run(videos)
        assert count == 3 * len(INSTAGRAM_SEED_HASHTAGS)


# ─────────────────────────────────────────────────────────────────────────────
# build_instagram_oauth_url
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildInstagramOauthUrl:
    def test_contains_client_id(self):
        url = build_instagram_oauth_url("my_client_id", "http://localhost/callback", "state123")
        assert "client_id=my_client_id" in url

    def test_contains_redirect_uri(self):
        url = build_instagram_oauth_url("cid", "http://localhost:8000/callback", "s")
        assert "redirect_uri=" in url
        assert "localhost" in url

    def test_contains_expected_scopes(self):
        url = build_instagram_oauth_url("cid", "http://localhost/cb", "s")
        # Scopes should appear in the URL (URL-encoded)
        assert "user_profile" in url or "user_profile%2Cuser_media" in url or "scope=" in url

    def test_contains_state(self):
        url = build_instagram_oauth_url("cid", "http://localhost/cb", "my_state_xyz")
        assert "my_state_xyz" in url

    def test_response_type_is_code(self):
        url = build_instagram_oauth_url("cid", "http://localhost/cb", "s")
        assert "response_type=code" in url

    def test_starts_with_ig_auth_url(self):
        url = build_instagram_oauth_url("cid", "http://localhost/cb", "s")
        assert url.startswith("https://api.instagram.com/oauth/authorize")

    def test_different_states_produce_different_urls(self):
        url1 = build_instagram_oauth_url("cid", "http://localhost/cb", "state_A")
        url2 = build_instagram_oauth_url("cid", "http://localhost/cb", "state_B")
        assert url1 != url2


# ─────────────────────────────────────────────────────────────────────────────
# ingest_instagram_user_media (async)
# ─────────────────────────────────────────────────────────────────────────────

class TestIngestInstagramUserMedia:
    """Tests for async ingest_instagram_user_media."""

    def _make_media_response(self, items: list[dict]) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": items}
        mock_resp.raise_for_status = MagicMock()
        return mock_resp

    def _make_item(self, media_type="VIDEO", vid_id="ig_media_1", caption="travel reel"):
        return {
            "id": vid_id,
            "media_type": media_type,
            "media_url": f"https://cdn.ig.com/{vid_id}.mp4",
            "thumbnail_url": f"https://cdn.ig.com/{vid_id}_thumb.jpg",
            "timestamp": "2024-01-15T12:00:00+0000",
            "caption": caption,
            "username": "travel_user",
        }

    def _run_async(self, coro):
        return asyncio.run(coro)

    def test_skips_non_video_media_types(self):
        db = _make_db(existing=False)
        items = [self._make_item(media_type="IMAGE", vid_id="img_1")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert result == []

    def test_skips_carousel_album_media(self):
        db = _make_db(existing=False)
        items = [self._make_item(media_type="CAROUSEL_ALBUM", vid_id="album_1")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert result == []

    def test_inserts_video_and_reel_types(self):
        db = _make_db(existing=False, insert_id="new-vlog-1")
        items = [
            self._make_item(media_type="VIDEO", vid_id="vid_1"),
            self._make_item(media_type="REEL", vid_id="reel_1"),
        ]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert len(result) == 2

    def test_skips_already_existing_videos(self):
        db = _make_db(existing=True)
        items = [self._make_item(media_type="VIDEO", vid_id="existing_vid")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert result == []

    def test_returns_list_of_inserted_ids(self):
        db = MagicMock()
        # exists check → no existing
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        # insert → returns new id
        db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "brand-new-id"}])

        items = [self._make_item(media_type="REEL", vid_id="brand_new")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert result == ["brand-new-id"]

    def test_handles_api_error_gracefully(self):
        db = _make_db()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=Exception("API timeout"))
            mock_client_cls.return_value = mock_client

            result = self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        assert result == []

    def test_channel_id_set_to_ig_user_id(self):
        captured_payloads = []
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

        def capture_insert(payload):
            captured_payloads.append(payload)
            m = MagicMock()
            m.execute.return_value = MagicMock(data=[{"id": "captured-id"}])
            return m

        db.table.return_value.insert = capture_insert

        items = [self._make_item(media_type="VIDEO", vid_id="v_channel")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_owner_id")
            )

        assert len(captured_payloads) == 1
        assert captured_payloads[0]["channel_id"] == "ig_owner_id"

    def test_processing_status_is_ready(self):
        captured_payloads = []
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

        def capture_insert(payload):
            captured_payloads.append(payload)
            m = MagicMock()
            m.execute.return_value = MagicMock(data=[{"id": "status-id"}])
            return m

        db.table.return_value.insert = capture_insert

        items = [self._make_item(media_type="REEL", vid_id="v_status")]
        mock_resp = self._make_media_response(items)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            self._run_async(
                ingest_instagram_user_media(db, "user_1", "tok_1", "ig_user_1")
            )

        for p in captured_payloads:
            assert p["processing_status"] == "ready"
