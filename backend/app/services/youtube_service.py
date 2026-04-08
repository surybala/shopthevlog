"""
YouTube helpers used by the AI pipeline.

Only caption extraction is still part of the supported backend surface.
Older YouTube ingest/search helpers were removed with the legacy feed/social stack.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def get_video_captions(video_id: str) -> Optional[str]:
    """
    Try to get captions via yt-dlp (handles auto-generated captions too).
    Returns plain text transcript or None.
    """
    try:
        import os
        import tempfile
        import yt_dlp

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                "skip_download": True,
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitlesformat": "vtt",
                "subtitleslangs": ["en", "en-US"],
                "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f"https://www.youtube.com/watch?v={video_id}"])

            for fname in os.listdir(tmpdir):
                if fname.endswith(".vtt"):
                    with open(os.path.join(tmpdir, fname), "r", encoding="utf-8") as f:
                        raw_vtt = f.read()
                    return _parse_vtt(raw_vtt)
        return None
    except Exception as e:
        logger.warning("get_video_captions failed for %s: %s", video_id, e)
        return None


def _parse_vtt(vtt: str) -> str:
    """Strip VTT timestamps and return clean text."""
    import re

    lines = vtt.splitlines()
    text_lines = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("WEBVTT") or "-->" in line or re.match(r"^\d+$", line):
            continue
        clean = re.sub(r"<[^>]+>", "", line)
        if clean:
            text_lines.append(clean)

    deduped = []
    prev = None
    for line in text_lines:
        if line != prev:
            deduped.append(line)
        prev = line
    return " ".join(deduped)
