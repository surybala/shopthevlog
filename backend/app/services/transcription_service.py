"""
Transcription pipeline:
1. Check for existing transcript in DB.
2. Try YouTube captions (yt-dlp, handles auto-generated).
3. Fall back to Whisper: download audio → compress → transcribe.
"""
import logging
import os
import tempfile
from typing import Optional

from openai import OpenAI

from app.core.config import settings
from app.db.client import get_supabase
from app.services.youtube_service import get_video_captions

logger = logging.getLogger(__name__)
openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)

MAX_WHISPER_BYTES = 24 * 1024 * 1024  # 24 MB (Whisper limit is 25 MB)


def transcribe_vlog(vlog_id: str) -> Optional[str]:
    """
    Main entry point. Returns the transcript string or None on failure.
    Side effects: updates vlogs.raw_transcript and vlogs.processing_status.
    """
    db = get_supabase()

    # 1. Load vlog row
    resp = db.table("vlogs").select("*").eq("id", vlog_id).single().execute()
    if not resp.data:
        logger.error(f"Vlog {vlog_id} not found")
        return None
    vlog = resp.data

    # 2. Already transcribed?
    if vlog.get("raw_transcript"):
        logger.info(f"Vlog {vlog_id} already has transcript, skipping transcription")
        return vlog["raw_transcript"]

    # 3. Update status
    db.table("vlogs").update({"processing_status": "transcribing"}).eq("id", vlog_id).execute()

    transcript: Optional[str] = None

    # 4. Try captions first (free, fast)
    if vlog["platform"] == "youtube":
        logger.info(f"Trying captions for YouTube video {vlog['platform_video_id']}")
        transcript = get_video_captions(vlog["platform_video_id"])

    # 5. Fall back to Whisper
    if not transcript:
        logger.info(f"Captions not available, falling back to Whisper for vlog {vlog_id}")
        transcript = _transcribe_with_whisper(vlog)

    if not transcript:
        db.table("vlogs").update({"processing_status": "failed", "processing_error": "Transcription failed"}).eq("id", vlog_id).execute()
        return None

    # 6. Persist transcript and advance status
    db.table("vlogs").update({
        "raw_transcript": transcript,
        "processing_status": "planning",
    }).eq("id", vlog_id).execute()

    return transcript


def _transcribe_with_whisper(vlog: dict) -> Optional[str]:
    """Download audio and send to OpenAI Whisper."""
    video_url = vlog.get("video_url")
    if not video_url:
        return None

    try:
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
            return str(response).strip()
    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return None


def _download_audio(url: str, tmpdir: str) -> Optional[str]:
    """
    Download audio from a video URL using yt-dlp, then compress to mono mp3
    under 24 MB using ffmpeg. Returns path to compressed audio file.
    """
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

        # Find the downloaded file
        downloaded = None
        for fname in os.listdir(tmpdir):
            if fname.startswith("audio_raw"):
                downloaded = os.path.join(tmpdir, fname)
                break

        if not downloaded:
            return None

        # Compress: mono, 16kHz, mp3
        (
            ffmpeg.input(downloaded)
            .audio
            .output(compressed_path, ac=1, ar=16000, audio_bitrate="32k")
            .overwrite_output()
            .run(quiet=True)
        )

        # Check size
        size = os.path.getsize(compressed_path)
        if size > MAX_WHISPER_BYTES:
            logger.warning(f"Compressed audio too large ({size} bytes), trimming to first 60 minutes")
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
