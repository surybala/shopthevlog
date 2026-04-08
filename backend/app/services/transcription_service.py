"""
Transcription pipeline:
1. Check for existing transcript in DB.
2. Try YouTube captions (yt-dlp) — fast and free, no download needed.
3. Try Gemini Flash 2.5 audio transcription — download audio, send to Gemini.
   - Files ≤ 18 MB are sent inline (no upload quota).
   - Larger files are uploaded via the Gemini File API, then deleted afterwards.

Reads/writes to the "Vlog" table via psycopg2.
"""
import logging
import os
import tempfile
from typing import Optional

from app.core.config import settings
from app.db.pg_client import PgClient
from app.services.youtube_service import get_video_captions

logger = logging.getLogger(__name__)

# Gemini's practical inline limit; above this we use the File API.
_INLINE_LIMIT_BYTES = 18 * 1024 * 1024   # 18 MB

# Trim audio to this duration before sending to Gemini for very long videos.
_MAX_AUDIO_SECONDS = 3600  # 1 hour


def transcribe_vlog(vlog_id: str) -> Optional[str]:
    """
    Main entry point. Returns the transcript string or None on failure.
    """
    with PgClient() as db:
        db.execute(
            '''SELECT id, "externalId", "externalUrl", "transcriptRaw",
                      "processingStatus", platform
               FROM "Vlog" WHERE id = %s''',
            (vlog_id,)
        )
        vlog = db.fetchone()

    if not vlog:
        logger.error("Vlog %s not found", vlog_id)
        return None

    # Re-use existing transcript if already transcribed.
    if vlog.get("transcriptRaw"):
        logger.info("Vlog %s already has transcript — skipping", vlog_id)
        return vlog["transcriptRaw"]

    with PgClient() as db:
        db.execute(
            'UPDATE "Vlog" SET "processingStatus" = \'TRANSCRIBING\' WHERE id = %s',
            (vlog_id,)
        )

    transcript: Optional[str] = None

    # ── Step 1: YouTube captions (free, instant, no audio download) ─────────
    if vlog.get("platform") == "YOUTUBE" and vlog.get("externalId"):
        logger.info("Trying YouTube captions for video %s", vlog["externalId"])
        transcript = get_video_captions(vlog["externalId"])

    # ── Step 2: Gemini audio transcription ───────────────────────────────────
    if not transcript:
        logger.info("Trying Gemini transcription for vlog %s", vlog_id)
        transcript = _transcribe_with_gemini(vlog)

    if not transcript:
        with PgClient() as db:
            db.execute(
                'UPDATE "Vlog" SET "processingStatus" = \'FAILED\' WHERE id = %s',
                (vlog_id,)
            )
        return None

    # Persist transcript and advance status.
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "transcriptRaw" = %s, "processingStatus" = 'EXTRACTING'
               WHERE id = %s''',
            (transcript, vlog_id)
        )

    return transcript


def _transcribe_with_gemini(vlog: dict) -> Optional[str]:
    """
    Download the vlog audio and transcribe it with Gemini Flash 2.5.

    Small files (≤ 18 MB) are sent inline in the request body.
    Large files are uploaded to the Gemini File API and deleted after use.
    """
    video_url = vlog.get("externalUrl")
    if not video_url:
        return None

    try:
        from google.genai import types
        from app.services.gemini_service import _client, GEMINI_MODEL

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = _download_audio(video_url, tmpdir)
            if not audio_path:
                return None

            client = _client()
            file_size = os.path.getsize(audio_path)
            prompt = (
                "Transcribe this audio accurately. "
                "Return only the spoken words — no timestamps, speaker labels, "
                "or section headers."
            )

            if file_size <= _INLINE_LIMIT_BYTES:
                # ── Inline (no File API quota used) ──────────────────────────
                logger.debug(
                    "Sending audio inline (%.1f MB)", file_size / 1024 / 1024
                )
                with open(audio_path, "rb") as f:
                    audio_bytes = f.read()
                contents = [
                    types.Part.from_bytes(data=audio_bytes, mime_type="audio/mpeg"),
                    types.Part.from_text(text=prompt),
                ]
                response = client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        max_output_tokens=8192,
                        temperature=0.0,
                    ),
                )
            else:
                # ── File API (larger audio) ───────────────────────────────────
                logger.debug(
                    "Uploading audio via File API (%.1f MB)", file_size / 1024 / 1024
                )
                uploaded = client.files.upload(
                    path=audio_path,
                    config=types.UploadFileConfig(mime_type="audio/mpeg"),
                )
                try:
                    contents = [
                        types.Part.from_uri(
                            file_uri=uploaded.uri, mime_type="audio/mpeg"
                        ),
                        types.Part.from_text(text=prompt),
                    ]
                    response = client.models.generate_content(
                        model=GEMINI_MODEL,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            max_output_tokens=8192,
                            temperature=0.0,
                        ),
                    )
                finally:
                    # Always clean up the uploaded file to avoid quota buildup.
                    try:
                        client.files.delete(name=uploaded.name)
                    except Exception as cleanup_err:
                        logger.warning(
                            "Could not delete Gemini file %s: %s",
                            uploaded.name, cleanup_err,
                        )

            text = (response.text or "").strip()
            if not text:
                logger.warning("Gemini returned empty transcript for vlog")
                return None

            logger.info("Gemini transcription succeeded (%d chars)", len(text))
            return text

    except Exception as e:
        logger.error("Gemini transcription failed: %s", e)
        return None


def _download_audio(url: str, tmpdir: str) -> Optional[str]:
    """
    Download the best audio stream via yt-dlp, then re-encode to:
      mono MP3 · 16 kHz · 32 kbps

    This keeps the file small for Gemini while preserving speech quality.
    Very long recordings are trimmed to 1 hour.

    YouTube 403 workaround: use the iOS player client, which YouTube treats as
    a trusted first-party app and does not block with bot-detection 403s.
    Falls back to the Android and web_creator clients if iOS also fails.
    """
    try:
        import yt_dlp
        import ffmpeg

        raw_path = os.path.join(tmpdir, "audio_raw.%(ext)s")
        compressed_path = os.path.join(tmpdir, "audio.mp3")

        # Try each player client in order until one works.
        # - ios / android: bypass 403 bot-detection; need simple "bestaudio/best"
        #   because they don't advertise the same container formats as the web client.
        # - tv_embedded: works for many videos that require sign-in on other clients.
        # - web_creator / web: last-resort fallbacks.
        player_clients = ["ios", "android", "tv_embedded", "web_creator", "web"]
        last_error: Optional[Exception] = None

        for client in player_clients:
            ydl_opts = {
                # Keep the selector simple so it works across all player clients.
                # Container-specific selectors (ext=m4a, etc.) cause "format not
                # available" errors on mobile clients that only expose generic streams.
                "format": "bestaudio/best",
                "outtmpl": raw_path,
                "quiet": True,
                "no_warnings": True,
                "extractor_args": {
                    "youtube": {"player_client": [client]},
                },
                "http_headers": {
                    # Mimic the iOS YouTube app to avoid bot detection
                    "User-Agent": (
                        "com.google.ios.youtube/19.29.1 "
                        "(iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"
                    ),
                },
            }
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                last_error = None
                break  # success — stop trying clients
            except Exception as e:
                logger.warning("yt-dlp player_client=%s failed: %s", client, e)
                last_error = e
                # Clean up any partial download before retrying
                for f in os.listdir(tmpdir):
                    if f.startswith("audio_raw"):
                        os.remove(os.path.join(tmpdir, f))

        if last_error:
            raise last_error

        downloaded = None
        for fname in os.listdir(tmpdir):
            if fname.startswith("audio_raw"):
                downloaded = os.path.join(tmpdir, fname)
                break
        if not downloaded:
            logger.error("yt-dlp produced no audio file")
            return None

        # Re-encode: mono, 16 kHz, 32 kbps — typical vlog speech is intelligible
        (
            ffmpeg.input(downloaded)
            .audio
            .output(compressed_path, ac=1, ar=16000, audio_bitrate="32k")
            .overwrite_output()
            .run(quiet=True)
        )

        # Trim very long recordings so we don't send multi-hour files
        size = os.path.getsize(compressed_path)
        if size > _INLINE_LIMIT_BYTES * 10:
            logger.warning(
                "Audio is large (%.1f MB) — trimming to %d minutes",
                size / 1024 / 1024, _MAX_AUDIO_SECONDS // 60,
            )
            trimmed_path = os.path.join(tmpdir, "audio_trimmed.mp3")
            (
                ffmpeg.input(compressed_path, t=_MAX_AUDIO_SECONDS)
                .output(trimmed_path)
                .overwrite_output()
                .run(quiet=True)
            )
            return trimmed_path

        return compressed_path

    except Exception as e:
        logger.error("Audio download/compress failed: %s", e)
        return None
