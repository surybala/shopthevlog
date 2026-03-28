"""
TikTok content service — public travel content via yt-dlp.

No API key or OAuth is required for fetching public hashtag pages.
Authenticated user-level features (user's own videos, followers, etc.)
require TikTok Login Kit credentials configured in settings.

Seeding strategy:
  - Search TikTok hashtag pages for popular travel content.
  - Convert raw yt-dlp metadata into the standard vlog insert payload.
  - Store with platform='tiktok' so the platform filter works.
"""
from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Public seed hashtags ───────────────────────────────────────────────────────
# Each tuple: (hashtag_without_hash, [travel_styles], [destinations])
TIKTOK_SEED_HASHTAGS: list[tuple[str, list[str], list[str]]] = [
    ("traveltiktok",    ["adventure"],              []),
    ("travelreels",     ["adventure", "cultural"],  []),
    ("luxurytravel",    ["luxury"],                 []),
    ("backpacking",     ["backpacking", "budget"],  []),
    ("solotravel",      ["solo"],                   []),
    ("beachlife",       ["beach"],                  []),
    ("foodtravel",      ["food & culinary"],        []),
    ("adventuretravel", ["adventure", "mountain"],  []),
    ("streetfood",      ["food & culinary", "cultural"], []),
    ("travelvlog",      ["cultural"],               []),
    ("familytravel",    ["family"],                 []),
    ("budgettravel",    ["budget"],                 []),
    ("wellnesstravel",  ["wellness"],               []),
    ("wildlifetravel",  ["wildlife", "adventure"],  []),
    ("roadtrip",        ["road trip"],              []),
    ("citybreak",       ["city break"],             []),
]


def _run_ytdlp(url: str, max_results: int = 10) -> list[dict]:
    """
    Run yt-dlp in flat-playlist / dump-json mode and return parsed dicts.
    Each line of stdout is a JSON object describing one video.
    """
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--dump-json",
                "--flat-playlist",
                "--playlist-items", f"1:{max_results}",
                "--no-warnings",
                "--quiet",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        videos: list[dict] = []
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                videos.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return videos
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out fetching %s", url)
        return []
    except FileNotFoundError:
        logger.warning("yt-dlp not found in PATH — skipping TikTok seeding")
        return []
    except Exception as exc:
        logger.warning("yt-dlp error for %s: %s", url, exc)
        return []


def search_tiktok_by_hashtag(hashtag: str, max_results: int = 10) -> list[dict]:
    """Fetch TikTok videos from a hashtag page via yt-dlp."""
    tag = hashtag.lstrip("#")
    url = f"https://www.tiktok.com/tag/{tag}"
    return _run_ytdlp(url, max_results=max_results)


def tiktok_raw_to_payload(
    data: dict,
    travel_styles: list[str] | None = None,
    destinations: list[str] | None = None,
) -> dict | None:
    """
    Convert a raw yt-dlp TikTok video dict into a vlog table insert payload.
    Returns None if the dict is missing required fields (video_id).
    """
    video_id = (
        data.get("id")
        or data.get("display_id")
        or data.get("webpage_url_basename")
    )
    if not video_id:
        return None

    url = (
        data.get("webpage_url")
        or data.get("url")
        or f"https://www.tiktok.com/@unknown/video/{video_id}"
    )

    # Thumbnail: prefer the first item in thumbnails[] if present
    thumbnail = data.get("thumbnail")
    if not thumbnail:
        thumbs = data.get("thumbnails") or []
        thumbnail = thumbs[0].get("url") if thumbs else None

    title = (data.get("title") or data.get("description") or "TikTok Travel Video")[:500]
    description = (data.get("description") or "")[:2000]
    uploader = data.get("uploader") or data.get("channel") or data.get("creator") or "TikTok Creator"
    channel_id = data.get("uploader_id") or data.get("channel_id") or ""
    duration = data.get("duration")
    view_count = data.get("view_count")
    like_count = data.get("like_count")

    timestamp = data.get("timestamp")
    try:
        published_at = (
            datetime.fromtimestamp(float(timestamp), tz=timezone.utc).isoformat()
            if timestamp is not None
            else None
        )
    except Exception:
        published_at = None

    return {
        "platform": "tiktok",
        "platform_video_id": str(video_id),
        "title": title,
        "description": description,
        "thumbnail_url": thumbnail,
        "video_url": url,
        "channel_name": uploader,
        "channel_id": str(channel_id),
        "duration_seconds": int(duration) if duration is not None else None,
        "published_at": published_at,
        "view_count": int(view_count) if view_count is not None else None,
        "like_count": int(like_count) if like_count is not None else None,
        "processing_status": "ready",
        "raw_transcript": description or title,
        "destinations": destinations or [],
        "travel_styles": travel_styles or [],
    }


def seed_tiktok_travel_content(db, max_per_hashtag: int = 8) -> int:
    """
    Iterate over TIKTOK_SEED_HASHTAGS, fetch videos via yt-dlp, and insert
    new rows into the vlogs table.  Already-existing rows (matched by
    platform_video_id) are skipped.
    Returns the count of newly inserted vlogs.
    """
    inserted = 0
    for hashtag, styles, dests in TIKTOK_SEED_HASHTAGS:
        try:
            raw_videos = search_tiktok_by_hashtag(hashtag, max_results=max_per_hashtag)
            for raw in raw_videos:
                payload = tiktok_raw_to_payload(raw, travel_styles=styles, destinations=dests)
                if not payload:
                    continue

                # Skip duplicates
                exists = (
                    db.table("vlogs")
                    .select("id")
                    .eq("platform_video_id", payload["platform_video_id"])
                    .eq("platform", "tiktok")
                    .execute()
                )
                if exists.data:
                    continue

                db.table("vlogs").insert(payload).execute()
                inserted += 1

        except Exception as exc:
            logger.warning("TikTok seed failed for #%s: %s", hashtag, exc)

    logger.info("TikTok seeding complete: %d vlogs inserted", inserted)
    return inserted
