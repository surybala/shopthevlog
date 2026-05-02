"""
Tests for app.services.transcription_service - Gemini-based audio transcription.

All external calls (yt-dlp, ffmpeg, Gemini API, PostgreSQL) are fully mocked.
No real network, disk I/O, or DB calls are made.
"""
from unittest.mock import MagicMock, mock_open, patch

from tests.conftest import FakePgClient


def _make_vlog(
    vlog_id: str = "vlog-001",
    platform: str = "YOUTUBE",
    external_id: str = "yt-abc",
    external_url: str = "https://youtube.com/watch?v=yt-abc",
    transcript_raw: str | None = None,
    status: str = "PENDING",
) -> dict:
    return {
        "id": vlog_id,
        "platform": platform,
        "externalId": external_id,
        "externalUrl": external_url,
        "transcriptRaw": transcript_raw,
        "processingStatus": status,
    }


def _make_gemini_response(text: str) -> MagicMock:
    response = MagicMock()
    response.text = text
    return response


def _patch_gemini_client(mock_client: MagicMock):
    return patch("app.services.gemini_service._client", return_value=mock_client)


def _patch_tempdir(path: str = "C:/tmp/mock-tempdir"):
    tempdir = MagicMock()
    tempdir.__enter__.return_value = path
    tempdir.__exit__.return_value = False
    return patch("tempfile.TemporaryDirectory", return_value=tempdir)


def _patch_small_audio(path: str = "C:/tmp/audio.mp3"):
    return (
        patch("app.services.transcription_service._download_audio", return_value=path),
        patch("os.path.getsize", return_value=1024),
        patch("builtins.open", mock_open(read_data=b"fake audio bytes")),
    )


def _patch_large_audio(path: str = "C:/tmp/audio_large.mp3"):
    return (
        patch("app.services.transcription_service._download_audio", return_value=path),
        patch("os.path.getsize", return_value=19 * 1024 * 1024),
    )


class TestTranscribeVlog:
    def test_returns_none_when_vlog_not_found(self):
        pg = FakePgClient(rows=[])
        with patch("app.services.transcription_service.PgClient", return_value=pg):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("no-such-vlog")
        assert result is None

    def test_returns_existing_transcript_without_re_transcribing(self):
        pg = FakePgClient(rows=[_make_vlog(transcript_raw="cached transcript")])
        with (
            patch("app.services.transcription_service.PgClient", return_value=pg),
            patch("app.services.transcription_service._transcribe_with_gemini") as mock_gem,
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-001")

        assert result == "cached transcript"
        mock_gem.assert_not_called()

    def test_youtube_captions_used_first_before_gemini(self):
        select_pg = FakePgClient(rows=[_make_vlog()])
        update_pgs = [FakePgClient(rows=[]), FakePgClient(rows=[])]

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, update_pgs[0], update_pgs[1]],
            ),
            patch(
                "app.services.transcription_service.get_video_captions",
                return_value="captions text",
            ) as mock_caps,
            patch("app.services.transcription_service._transcribe_with_gemini") as mock_gem,
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-001")

        assert result == "captions text"
        mock_caps.assert_called_once_with("yt-abc")
        mock_gem.assert_not_called()

    def test_gemini_called_when_captions_unavailable(self):
        select_pg = FakePgClient(rows=[_make_vlog()])
        update_pgs = [FakePgClient(rows=[]), FakePgClient(rows=[])]

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, update_pgs[0], update_pgs[1]],
            ),
            patch("app.services.transcription_service.get_video_captions", return_value=None),
            patch(
                "app.services.transcription_service._transcribe_with_gemini",
                return_value="gemini transcript",
            ) as mock_gem,
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-001")

        assert result == "gemini transcript"
        mock_gem.assert_called_once()

    def test_marks_failed_when_both_sources_return_none(self):
        select_pg = FakePgClient(rows=[_make_vlog()])
        transcribing_pg = FakePgClient(rows=[])
        failed_pg = FakePgClient(rows=[])

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, transcribing_pg, failed_pg],
            ),
            patch("app.services.transcription_service.get_video_captions", return_value=None),
            patch("app.services.transcription_service._transcribe_with_gemini", return_value=None),
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-001")

        assert result is None
        sql, params = failed_pg.cursor.queries[0]
        assert "FAILED" in sql

    def test_marks_transcribing_before_attempting(self):
        select_pg = FakePgClient(rows=[_make_vlog()])
        transcribing_pg = FakePgClient(rows=[])
        done_pg = FakePgClient(rows=[])

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, transcribing_pg, done_pg],
            ),
            patch("app.services.transcription_service.get_video_captions", return_value="text"),
        ):
            from app.services.transcription_service import transcribe_vlog

            transcribe_vlog("vlog-001")

        sql, params = transcribing_pg.cursor.queries[0]
        assert "TRANSCRIBING" in sql
        assert params == ("vlog-001",)

    def test_saves_transcript_and_advances_to_extracting(self):
        select_pg = FakePgClient(rows=[_make_vlog()])
        transcribing_pg = FakePgClient(rows=[])
        save_pg = FakePgClient(rows=[])

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, transcribing_pg, save_pg],
            ),
            patch(
                "app.services.transcription_service.get_video_captions",
                return_value="my transcript",
            ),
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-001")

        assert result == "my transcript"
        sql, params = save_pg.cursor.queries[0]
        assert "EXTRACTING" in sql
        assert params[0] == "my transcript"
        assert params[1] == "vlog-001"

    def test_non_youtube_vlog_skips_captions_goes_straight_to_gemini(self):
        vlog = _make_vlog(
            platform="TIKTOK",
            external_id="tiktok-id",
            external_url="https://tiktok.com/v/123",
        )
        select_pg = FakePgClient(rows=[vlog])
        update_pgs = [FakePgClient(rows=[]), FakePgClient(rows=[])]

        with (
            patch(
                "app.services.transcription_service.PgClient",
                side_effect=[select_pg, update_pgs[0], update_pgs[1]],
            ),
            patch("app.services.transcription_service.get_video_captions") as mock_caps,
            patch(
                "app.services.transcription_service._transcribe_with_gemini",
                return_value="tiktok transcript",
            ),
        ):
            from app.services.transcription_service import transcribe_vlog

            result = transcribe_vlog("vlog-tiktok")

        assert result == "tiktok transcript"
        mock_caps.assert_not_called()


class TestTranscribeWithGemini:
    def _vlog(self, **kwargs):
        return _make_vlog(**kwargs)

    def test_returns_none_when_no_url(self):
        from app.services.transcription_service import _transcribe_with_gemini

        vlog = {"id": "v1", "externalUrl": None}
        assert _transcribe_with_gemini(vlog) is None

    def test_returns_none_when_audio_download_fails(self):
        with patch("app.services.transcription_service._download_audio", return_value=None):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())
        assert result is None

    def test_sends_inline_for_small_files(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_gemini_response(
            "Hello from Tokyo!"
        )

        download_patch, size_patch, open_patch = _patch_small_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            open_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result == "Hello from Tokyo!"
        mock_client.files.upload.assert_not_called()

    def test_uses_file_api_for_large_files(self):
        mock_uploaded = MagicMock()
        mock_uploaded.uri = "https://generativelanguage.googleapis.com/files/abc123"
        mock_uploaded.name = "files/abc123"

        mock_client = MagicMock()
        mock_client.files.upload.return_value = mock_uploaded
        mock_client.models.generate_content.return_value = _make_gemini_response(
            "Big file transcript"
        )

        download_patch, size_patch = _patch_large_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result == "Big file transcript"
        mock_client.files.upload.assert_called_once()

    def test_deletes_uploaded_file_after_transcription(self):
        mock_uploaded = MagicMock()
        mock_uploaded.uri = "https://example.com/files/abc"
        mock_uploaded.name = "files/abc"

        mock_client = MagicMock()
        mock_client.files.upload.return_value = mock_uploaded
        mock_client.models.generate_content.return_value = _make_gemini_response("transcript")

        download_patch, size_patch = _patch_large_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            _transcribe_with_gemini(self._vlog())

        mock_client.files.delete.assert_called_once_with(name="files/abc")

    def test_deletes_file_even_when_transcription_fails(self):
        mock_uploaded = MagicMock()
        mock_uploaded.uri = "https://example.com/files/fail"
        mock_uploaded.name = "files/fail"

        mock_client = MagicMock()
        mock_client.files.upload.return_value = mock_uploaded
        mock_client.models.generate_content.side_effect = RuntimeError("Gemini down")

        download_patch, size_patch = _patch_large_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result is None
        mock_client.files.delete.assert_called_once_with(name="files/fail")

    def test_returns_none_on_empty_gemini_response(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_gemini_response("")

        download_patch, size_patch, open_patch = _patch_small_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            open_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result is None

    def test_returns_none_on_gemini_exception(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = RuntimeError("timeout")

        download_patch, size_patch, open_patch = _patch_small_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            open_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result is None

    def test_transcript_is_trimmed_of_whitespace(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_gemini_response(
            "  transcript with spaces  \n"
        )

        download_patch, size_patch, open_patch = _patch_small_audio()
        with (
            _patch_tempdir(),
            download_patch,
            size_patch,
            open_patch,
            _patch_gemini_client(mock_client),
        ):
            from app.services.transcription_service import _transcribe_with_gemini

            result = _transcribe_with_gemini(self._vlog())

        assert result == "transcript with spaces"
