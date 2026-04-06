"""
Transcription pipeline:
1. Check for existing transcript in DB.
2. Try YouTube captions (yt-dlp) — fast and free.
3. Try OpenAI Whisper API — cloud fallback.
4. Try local Whisper — only if WHISPER_LOCAL_ENABLED=true.

Reads/writes to the new "Vlog" table via psycopg2.
"""
import concurrent.futures
import logging
import os
import tempfile
from typing import Optional

LOCAL_WHISPER_TIMEOUT_SECONDS = 300  # 5 min timeout for local Whisper

from app.core.config import settings
from app.db.pg_client import PgClient
from app.services.youtube_service import get_video_captions

logger = logging.getLogger(__name__)

MAX_WHISPER_BYTES = 24 * 1024 * 1024  # 24 MB (OpenAI Whisper API limit is 25 MB)


def transcribe_vlog(vlog_id: str) -> Optional[str]:
    """
    Main entry point. Returns transcript string or None on failure.
    Reads/writes "Vlog" table in the Prisma PostgreSQL schema.
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
        logger.error(f"Vlog {vlog_id} not found")
        return None

    # Already transcribed?
    if vlog.get("transcriptRaw"):
        logger.info(f"Vlog {vlog_id} already has transcript, skipping")
        return vlog["transcriptRaw"]

    # Mark as transcribing
    with PgClient() as db:
        db.execute(
            'UPDATE "Vlog" SET "processingStatus" = \'TRANSCRIBING\' WHERE id = %s',
            (vlog_id,)
        )

    transcript: Optional[str] = None

    # Try YouTube captions first (fast, free, no download needed)
    if vlog.get("platform") == "YOUTUBE" and vlog.get("externalId"):
        logger.info(f"Trying YouTube captions for {vlog['externalId']}")
        transcript = get_video_captions(vlog["externalId"])

    # Try OpenAI Whisper API
    if not transcript:
        logger.info(f"Trying OpenAI Whisper API for vlog {vlog_id}")
        transcript = _transcribe_with_openai_whisper(vlog)

    # Try local Whisper (slow — only if explicitly enabled)
    if not transcript and settings.WHISPER_LOCAL_ENABLED:
        logger.info(f"Trying local Whisper for vlog {vlog_id}")
        transcript = _transcribe_with_local_whisper(vlog)

    if not transcript:
        with PgClient() as db:
            db.execute(
                'UPDATE "Vlog" SET "processingStatus" = \'FAILED\' WHERE id = %s',
                (vlog_id,)
            )
        return None

    # Persist transcript and advance to EXTRACTING
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "transcriptRaw" = %s, "processingStatus" = 'EXTRACTING'
               WHERE id = %s''',
            (transcript, vlog_id)
        )

    return transcript


def _transcribe_with_openai_whisper(vlog: dict) -> Optional[str]:
    if not settings.OPENAI_API_KEY:
        logger.info("No OPENAI_API_KEY, skipping OpenAI Whisper")
        return None
    video_url = vlog.get("externalUrl")
    if not video_url:
        return None
    try:
        from openai import OpenAI
        openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = _download_audio(video_url, tmpdir)
            if not audio_path:
                return None
            with open(audio_path, "rb") as audio_file:
                response = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="text",
                )
        text = str(response).strip()
        if not text:
            return None
        logger.info(f"OpenAI Whisper succeeded ({len(text)} chars)")
        return text
    except Exception as e:
        logger.error(f"OpenAI Whisper failed: {e}")
        return None


def _transcribe_with_local_whisper(vlog: dict) -> Optional[str]:
    try:
        import whisper
    except ImportError:
        logger.info("openai-whisper not installed, skipping local Whisper")
        return None
    video_url = vlog.get("externalUrl")
    if not video_url:
        return None
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = _download_audio(video_url, tmpdir)
            if not audio_path:
                return None
            model = whisper.load_model(settings.WHISPER_LOCAL_MODEL)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(model.transcribe, audio_path, fp16=False)
                try:
                    result = future.result(timeout=LOCAL_WHISPER_TIMEOUT_SECONDS)
                except concurrent.futures.TimeoutError:
                    logger.warning(f"Local Whisper timed out after {LOCAL_WHISPER_TIMEOUT_SECONDS}s")
                    return None
            text = result.get("text", "").strip()
            return text or None
    except Exception as e:
        logger.error(f"Local Whisper failed: {e}")
        return None


def _download_audio(url: str, tmpdir: str) -> Optional[str]:
    """Download audio via yt-dlp and compress to mono mp3 under 24 MB."""
    try:
        import yt_dlp
        import ffmpeg

        raw_path = os.path.join(tmpdir, "audio_raw.%(ext)s")
        compressed_path = os.path.join(tmpdir, "audio.mp3")

        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio",
            "outtmpl": raw_path,
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        downloaded = None
        for fname in os.listdir(tmpdir):
            if fname.startswith("audio_raw"):
                downloaded = os.path.join(tmpdir, fname)
                break
        if not downloaded:
            return None

        (
            ffmpeg.input(downloaded)
            .audio
            .output(compressed_path, ac=1, ar=16000, audio_bitrate="32k")
            .overwrite_output()
            .run(quiet=True)
        )

        size = os.path.getsize(compressed_path)
        if size > MAX_WHISPER_BYTES:
            logger.warning(f"Audio too large ({size} bytes), trimming to 60 min")
            trimmed_path = os.path.join(tmpdir, "audio_trimmed.mp3")
            (
                ffmpeg.input(compressed_path, t=3600)
                .output(trimmed_path)
                .overwrite_output()
                .run(quiet=True)
            )
            return trimmed_path

        return compressed_path
    except Exception as e:
        logger.error(f"Audio download/compress failed: {e}")
        return None
