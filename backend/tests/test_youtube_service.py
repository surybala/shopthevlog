"""
Tests for app.services.youtube_service — pure-function helpers and mocked API calls.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, mock_open


# ─────────────────────────────────────────────────────────────────────────────
# _iso_duration_to_seconds
# ─────────────────────────────────────────────────────────────────────────────

class TestIsoDurationToSeconds:
    def test_full_hms(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT1H2M3S") == 3723

    def test_hours_only(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT2H") == 7200

    def test_minutes_only(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT30M") == 1800

    def test_seconds_only(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT45S") == 45

    def test_zero_duration(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT0S") == 0

    def test_minutes_and_seconds(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT5M30S") == 330

    def test_invalid_returns_zero(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("not-valid") == 0

    def test_empty_string_returns_zero(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("") == 0

    def test_large_hours(self):
        from app.services.youtube_service import _iso_duration_to_seconds
        assert _iso_duration_to_seconds("PT10H") == 36000


# ─────────────────────────────────────────────────────────────────────────────
# _parse_vtt
# ─────────────────────────────────────────────────────────────────────────────

class TestParseVtt:
    def test_strips_webvtt_header(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello world"
        result = _parse_vtt(vtt)
        assert "Hello world" in result
        assert "WEBVTT" not in result

    def test_strips_timestamps(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFirst line"
        result = _parse_vtt(vtt)
        assert "-->" not in result

    def test_strips_html_tags(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c.color>Hello</c>"
        result = _parse_vtt(vtt)
        assert "<" not in result
        assert "Hello" in result

    def test_deduplicates_consecutive_lines(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nDuplicate line\n00:00:02.000 --> 00:00:03.000\nDuplicate line\n00:00:03.000 --> 00:00:04.000\nUnique line"
        result = _parse_vtt(vtt)
        # "Duplicate line" appears only once
        assert result.count("Duplicate line") == 1

    def test_skips_numeric_cue_ids(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nCue content"
        result = _parse_vtt(vtt)
        assert "1" not in result.split()  # numeric cue id stripped
        assert "Cue content" in result

    def test_multiple_lines_joined_with_spaces(self):
        from app.services.youtube_service import _parse_vtt
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst\n00:00:02.000 --> 00:00:03.000\nSecond"
        result = _parse_vtt(vtt)
        assert "First" in result
        assert "Second" in result

    def test_empty_vtt_returns_empty_string(self):
        from app.services.youtube_service import _parse_vtt
        result = _parse_vtt("")
        assert result == ""

    def test_only_header_returns_empty(self):
        from app.services.youtube_service import _parse_vtt
        result = _parse_vtt("WEBVTT\n\n")
        assert result.strip() == ""


# ─────────────────────────────────────────────────────────────────────────────
# search_travel_vlogs
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchTravelVlogs:
    def _make_yt_mock(self, search_items=None, detail_items=None):
        yt = MagicMock()
        search_resp = {"items": search_items or []}
        detail_resp = {"items": detail_items or []}

        yt.search.return_value.list.return_value.execute.return_value = search_resp
        yt.videos.return_value.list.return_value.execute.return_value = detail_resp
        return yt

    def test_returns_empty_when_no_search_results(self):
        from app.services.youtube_service import search_travel_vlogs
        with patch("app.services.youtube_service.build") as mock_build:
            mock_build.return_value = self._make_yt_mock(search_items=[])
            result = search_travel_vlogs("japan travel", max_results=5)
        assert result == []

    def test_returns_vlog_metadata_objects(self):
        from app.services.youtube_service import search_travel_vlogs, VlogMetadata
        search_items = [{"id": {"videoId": "vid-1"}}]
        detail_items = [
            {
                "id": "vid-1",
                "snippet": {
                    "title": "Japan Trip",
                    "description": "Great trip",
                    "channelTitle": "TravelChan",
                    "channelId": "ch-1",
                    "publishedAt": "2024-01-15T10:00:00Z",
                    "thumbnails": {"high": {"url": "https://thumb.jpg"}},
                },
                "statistics": {"viewCount": "100000", "likeCount": "5000"},
                "contentDetails": {"duration": "PT15M30S"},
            }
        ]
        with patch("app.services.youtube_service.build") as mock_build:
            mock_build.return_value = self._make_yt_mock(search_items, detail_items)
            result = search_travel_vlogs("japan travel")

        assert len(result) == 1
        assert isinstance(result[0], VlogMetadata)
        assert result[0].platform == "youtube"
        assert result[0].platform_video_id == "vid-1"
        assert result[0].title == "Japan Trip"
        assert result[0].duration_seconds == 930  # 15*60+30
        assert result[0].view_count == 100000
        assert result[0].like_count == 5000
        assert result[0].channel_name == "TravelChan"

    def test_handles_api_exception_gracefully(self):
        from app.services.youtube_service import search_travel_vlogs
        with patch("app.services.youtube_service.build", side_effect=Exception("API error")):
            result = search_travel_vlogs("japan")
        assert result == []

    def test_video_url_constructed_correctly(self):
        from app.services.youtube_service import search_travel_vlogs
        search_items = [{"id": {"videoId": "abc123"}}]
        detail_items = [
            {
                "id": "abc123",
                "snippet": {"title": "Trip", "thumbnails": {}, "publishedAt": None,
                            "channelTitle": None, "channelId": None},
                "statistics": {},
                "contentDetails": {"duration": "PT0S"},
            }
        ]
        with patch("app.services.youtube_service.build") as mock_build:
            mock_build.return_value = self._make_yt_mock(search_items, detail_items)
            result = search_travel_vlogs("trip")
        assert result[0].video_url == "https://www.youtube.com/watch?v=abc123"

    def test_none_stats_handled(self):
        from app.services.youtube_service import search_travel_vlogs
        search_items = [{"id": {"videoId": "v1"}}]
        detail_items = [
            {
                "id": "v1",
                "snippet": {"title": "T", "thumbnails": {}, "publishedAt": None,
                            "channelTitle": None, "channelId": None},
                "statistics": {},  # no viewCount / likeCount
                "contentDetails": {"duration": "PT5M"},
            }
        ]
        with patch("app.services.youtube_service.build") as mock_build:
            mock_build.return_value = self._make_yt_mock(search_items, detail_items)
            result = search_travel_vlogs("trip")
        assert result[0].view_count is None
        assert result[0].like_count is None


# ─────────────────────────────────────────────────────────────────────────────
# get_video_captions
# ─────────────────────────────────────────────────────────────────────────────

class TestGetVideoCaptions:
    """
    get_video_captions uses yt_dlp internally via a lazy import.
    We patch at the sys.modules level so the lazy `import yt_dlp` inside the
    function finds our mock instead of the real package (which may not be
    installed in the test environment).
    """

    def _make_ydl_mock(self):
        mock_ydl_instance = MagicMock()
        mock_ydl_instance.__enter__ = lambda s: s
        mock_ydl_instance.__exit__ = MagicMock(return_value=False)
        mock_ydl_class = MagicMock(return_value=mock_ydl_instance)
        mock_yt_dlp = MagicMock()
        mock_yt_dlp.YoutubeDL = mock_ydl_class
        return mock_yt_dlp, mock_ydl_instance

    def test_returns_none_when_no_vtt_file(self):
        from app.services.youtube_service import get_video_captions
        import sys

        mock_yt_dlp, _ = self._make_ydl_mock()
        with (
            patch.dict(sys.modules, {"yt_dlp": mock_yt_dlp}),
            patch("os.listdir", return_value=["video.mp4"]),
            patch("tempfile.TemporaryDirectory") as mock_tmpdir,
        ):
            ctx = MagicMock()
            ctx.__enter__ = lambda s: "/tmp/test"
            ctx.__exit__ = MagicMock(return_value=False)
            mock_tmpdir.return_value = ctx
            result = get_video_captions("vid-123")
        assert result is None

    def test_returns_parsed_text_when_vtt_exists(self):
        from app.services.youtube_service import get_video_captions
        import sys

        vtt_content = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from captions"
        mock_yt_dlp, _ = self._make_ydl_mock()
        with (
            patch.dict(sys.modules, {"yt_dlp": mock_yt_dlp}),
            patch("os.listdir", return_value=["vid-123.en.vtt"]),
            patch("builtins.open", mock_open(read_data=vtt_content)),
            patch("os.path.join", side_effect=lambda *a: "/".join(str(x) for x in a)),
            patch("tempfile.TemporaryDirectory") as mock_tmpdir,
        ):
            ctx = MagicMock()
            ctx.__enter__ = lambda s: "/tmp/test"
            ctx.__exit__ = MagicMock(return_value=False)
            mock_tmpdir.return_value = ctx
            result = get_video_captions("vid-123")
        assert result is not None
        assert "Hello from captions" in result

    def test_returns_none_on_exception(self):
        from app.services.youtube_service import get_video_captions
        import sys

        mock_yt_dlp = MagicMock()
        mock_yt_dlp.YoutubeDL.side_effect = Exception("yt-dlp error")
        with (
            patch.dict(sys.modules, {"yt_dlp": mock_yt_dlp}),
            patch("tempfile.TemporaryDirectory") as mock_tmpdir,
        ):
            ctx = MagicMock()
            ctx.__enter__ = lambda s: "/tmp/test"
            ctx.__exit__ = MagicMock(return_value=False)
            mock_tmpdir.return_value = ctx
            result = get_video_captions("vid-bad")
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# get_user_subscriptions
# ─────────────────────────────────────────────────────────────────────────────

class TestGetUserSubscriptions:
    def _make_db(self, conn_data=None, subs_items=None):
        conn_data = conn_data or []
        subs_response = {"items": subs_items or [], "nextPageToken": None}

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        execute_result = MagicMock()
        execute_result.data = conn_data
        chain.execute.return_value = execute_result

        db = MagicMock()
        db.table.return_value = chain
        return db, subs_response

    def test_returns_empty_set_when_no_connection(self):
        from app.services.youtube_service import get_user_subscriptions
        db, _ = self._make_db(conn_data=[])
        with patch("app.services.youtube_service.get_supabase", return_value=db):
            result = get_user_subscriptions("user-1")
        assert result == set()

    def test_returns_channel_ids_from_subscriptions(self):
        from app.services.youtube_service import get_user_subscriptions
        conn_data = [{"access_token": "tok", "refresh_token": "ref"}]
        subs_items = [
            {"snippet": {"resourceId": {"channelId": "ch-A"}}},
            {"snippet": {"resourceId": {"channelId": "ch-B"}}},
        ]
        db, subs_resp = self._make_db(conn_data, subs_items)

        mock_yt = MagicMock()
        mock_yt.subscriptions.return_value.list.return_value.execute.return_value = subs_resp

        with (
            patch("app.services.youtube_service.get_supabase", return_value=db),
            patch("app.services.youtube_service._build_youtube_client",
                  return_value=(mock_yt, MagicMock())),
        ):
            result = get_user_subscriptions("user-1")
        assert "ch-A" in result
        assert "ch-B" in result

    def test_returns_empty_set_on_api_exception(self):
        from app.services.youtube_service import get_user_subscriptions
        conn_data = [{"access_token": "tok", "refresh_token": "ref"}]
        db, _ = self._make_db(conn_data=conn_data)

        with (
            patch("app.services.youtube_service.get_supabase", return_value=db),
            patch("app.services.youtube_service._build_youtube_client",
                  side_effect=Exception("OAuth error")),
        ):
            result = get_user_subscriptions("user-1")
        assert result == set()

    def test_skips_items_without_channel_id(self):
        from app.services.youtube_service import get_user_subscriptions
        conn_data = [{"access_token": "tok", "refresh_token": "ref"}]
        subs_items = [
            {"snippet": {"resourceId": {}}},  # no channelId
            {"snippet": {"resourceId": {"channelId": "ch-good"}}},
        ]
        subs_resp = {"items": subs_items, "nextPageToken": None}
        db, _ = self._make_db(conn_data=conn_data)

        mock_yt = MagicMock()
        mock_yt.subscriptions.return_value.list.return_value.execute.return_value = subs_resp

        with (
            patch("app.services.youtube_service.get_supabase", return_value=db),
            patch("app.services.youtube_service._build_youtube_client",
                  return_value=(mock_yt, MagicMock())),
        ):
            result = get_user_subscriptions("user-1")
        assert result == {"ch-good"}


# ─────────────────────────────────────────────────────────────────────────────
# ingest_new_vlogs_for_user
# ─────────────────────────────────────────────────────────────────────────────

class TestIngestNewVlogsForUser:
    def _make_db(self, conn_data=None, exists_data=None, insert_data=None):
        conn_data = conn_data or []
        exists_data = exists_data or []
        insert_data = insert_data or [{"id": "new-vlog-1"}]

        class _Table:
            def __init__(self, data):
                self._data = data

            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def insert(self, *a, **kw): return self
            def execute(self):
                r = MagicMock()
                r.data = self._data
                return r

        db = MagicMock()

        call_count = {"n": 0}

        def _table_factory(name):
            if name == "social_connections":
                return _Table(conn_data)
            elif name == "vlogs":
                call_count["n"] += 1
                if call_count["n"] % 2 == 0:
                    return _Table(insert_data)
                return _Table(exists_data)
            return _Table([])

        db.table = _table_factory
        return db

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_connection(self):
        from app.services.youtube_service import ingest_new_vlogs_for_user
        db = self._make_db(conn_data=[])
        with patch("app.services.youtube_service.get_supabase", return_value=db):
            result = await ingest_new_vlogs_for_user("user-1")
        assert result == []

    @pytest.mark.asyncio
    async def test_inserts_new_vlogs_and_returns_ids(self):
        from app.services.youtube_service import ingest_new_vlogs_for_user, VlogMetadata
        conn = [{"access_token": "tok", "refresh_token": "ref", "platform_user_id": "ch-1"}]

        fake_video = VlogMetadata(
            platform="youtube",
            platform_video_id="vid-new",
            title="New Vlog",
            description="Desc",
            thumbnail_url="https://thumb.jpg",
            video_url="https://youtube.com/watch?v=vid-new",
            channel_name="Chan",
            channel_id="ch-1",
            duration_seconds=600,
            published_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
            view_count=1000,
            like_count=50,
        )

        # Build a DB where the `vlogs` table returns: no existing, then insert response
        class _DB:
            def __init__(self):
                self._call = 0

            def table(self, name):
                if name == "social_connections":
                    return _T(conn)
                if name == "vlogs":
                    self._call += 1
                    if self._call % 2 == 1:
                        return _T([])          # select → no existing
                    return _T([{"id": "new-1"}])  # insert
                return _T([])

        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def insert(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with (
            patch("app.services.youtube_service.get_supabase", return_value=_DB()),
            patch("app.services.youtube_service.fetch_channel_videos", return_value=[fake_video]),
        ):
            result = await ingest_new_vlogs_for_user("user-1")
        assert "new-1" in result

    @pytest.mark.asyncio
    async def test_skips_existing_vlogs(self):
        from app.services.youtube_service import ingest_new_vlogs_for_user, VlogMetadata
        conn = [{"access_token": "tok", "refresh_token": "ref", "platform_user_id": "ch-1"}]
        existing = [{"id": "existing-vlog-id"}]

        fake_video = VlogMetadata(
            platform="youtube", platform_video_id="vid-exists", title="Old Vlog",
            description=None, thumbnail_url=None, video_url=None,
            channel_name=None, channel_id=None, duration_seconds=None,
            published_at=None, view_count=None, like_count=None,
        )

        class _DB:
            def table(self, name):
                if name == "social_connections": return _T(conn)
                return _T(existing)  # always returns existing on select

        class _T:
            def __init__(self, data): self._data = data
            def select(self, *a, **kw): return self
            def eq(self, *a, **kw): return self
            def insert(self, *a, **kw): return self
            def execute(self):
                r = MagicMock(); r.data = self._data; return r

        with (
            patch("app.services.youtube_service.get_supabase", return_value=_DB()),
            patch("app.services.youtube_service.fetch_channel_videos", return_value=[fake_video]),
        ):
            result = await ingest_new_vlogs_for_user("user-1")
        assert result == []


# ─────────────────────────────────────────────────────────────────────────────
# fetch_channel_videos
# ─────────────────────────────────────────────────────────────────────────────

class TestFetchChannelVideos:
    def test_returns_empty_when_channel_not_found(self):
        from app.services.youtube_service import fetch_channel_videos
        mock_yt = MagicMock()
        mock_yt.channels.return_value.list.return_value.execute.return_value = {"items": []}

        with patch("app.services.youtube_service._build_youtube_client",
                   return_value=(mock_yt, MagicMock())):
            result = fetch_channel_videos("ch-1", "tok", "ref")
        assert result == []

    def test_returns_empty_on_exception(self):
        from app.services.youtube_service import fetch_channel_videos
        with patch("app.services.youtube_service._build_youtube_client",
                   side_effect=Exception("OAuth fail")):
            result = fetch_channel_videos("ch-1", "tok", "ref")
        assert result == []

    def test_returns_vlog_metadata_list(self):
        from app.services.youtube_service import fetch_channel_videos, VlogMetadata
        mock_yt = MagicMock()

        channels_resp = {
            "items": [{
                "contentDetails": {"relatedPlaylists": {"uploads": "UU_playlist"}}
            }]
        }
        playlist_resp = {
            "items": [{"contentDetails": {"videoId": "vid-1"}}],
            "nextPageToken": None,
        }
        details_resp = {
            "items": [{
                "id": "vid-1",
                "snippet": {
                    "title": "Trip Video",
                    "description": "Great",
                    "channelTitle": "TravelChan",
                    "channelId": "ch-x",
                    "publishedAt": "2024-03-10T12:00:00Z",
                    "thumbnails": {"high": {"url": "https://thumb.jpg"}},
                },
                "statistics": {"viewCount": "5000", "likeCount": "300"},
                "contentDetails": {"duration": "PT20M"},
            }]
        }

        mock_yt.channels.return_value.list.return_value.execute.return_value = channels_resp
        mock_yt.playlistItems.return_value.list.return_value.execute.return_value = playlist_resp
        mock_yt.videos.return_value.list.return_value.execute.return_value = details_resp

        with patch("app.services.youtube_service._build_youtube_client",
                   return_value=(mock_yt, MagicMock())):
            result = fetch_channel_videos("ch-1", "tok", "ref")

        assert len(result) == 1
        assert isinstance(result[0], VlogMetadata)
        assert result[0].platform_video_id == "vid-1"
        assert result[0].duration_seconds == 1200
        assert result[0].view_count == 5000
