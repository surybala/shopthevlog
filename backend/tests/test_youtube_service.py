"""
Tests for the remaining YouTube caption helpers used by the AI pipeline.
"""
from unittest.mock import MagicMock, mock_open, patch


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

        vtt = (
            "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nDuplicate line\n"
            "00:00:02.000 --> 00:00:03.000\nDuplicate line\n"
            "00:00:03.000 --> 00:00:04.000\nUnique line"
        )
        result = _parse_vtt(vtt)
        assert result.count("Duplicate line") == 1

    def test_skips_numeric_cue_ids(self):
        from app.services.youtube_service import _parse_vtt

        vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nCue content"
        result = _parse_vtt(vtt)
        assert "1" not in result.split()
        assert "Cue content" in result

    def test_empty_vtt_returns_empty_string(self):
        from app.services.youtube_service import _parse_vtt

        assert _parse_vtt("") == ""


class TestGetVideoCaptions:
    def _make_ydl_mock(self):
        mock_ydl_instance = MagicMock()
        mock_ydl_instance.__enter__ = lambda s: s
        mock_ydl_instance.__exit__ = MagicMock(return_value=False)
        mock_ydl_class = MagicMock(return_value=mock_ydl_instance)
        mock_yt_dlp = MagicMock()
        mock_yt_dlp.YoutubeDL = mock_ydl_class
        return mock_yt_dlp

    def test_returns_none_when_no_vtt_file(self):
        from app.services.youtube_service import get_video_captions
        import sys

        mock_yt_dlp = self._make_ydl_mock()
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
        mock_yt_dlp = self._make_ydl_mock()
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
