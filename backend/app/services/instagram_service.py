"""
Instagram content service — public travel Reels via yt-dlp,
and authenticated content via the Instagram Basic Display API.

Public hashtag seeding works without any credentials.
User OAuth requires INSTAGRAM_CLIENT_ID + INSTAGRAM_CLIENT_SECRET in settings.

Instagram Basic Display API:
  Auth URL  : https://api.instagram.com/oauth/authorize
  Token URL : https://api.instagram.com/oauth/access_token
  Graph URL : https://graph.instagram.com/me/media
"""
from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Public seed hashtags ───────────────────────────────────────────────────────
INSTAGRAM_SEED_HASHTAGS: list[tuple[str, list[str], list[str]]] = [
    ("travel",          ["adventure", "cultural"],  []),
    ("luxurytravel",    ["luxury"],                 []),
    ("backpacker",      ["backpacking", "budget"],  []),
    ("solotravel",      ["solo"],                   []),
    ("beachlife",       ["beach"],                  []),
    ("foodie",          ["food & culinary"],        []),
    ("hiking",          ["mountain", "adventure"],  []),
    ("wanderlust",      ["adventure"],              []),
    ("travelgram",      ["cultural"],               []),
    ("travelphotography", ["photography"],          []),
    ("familyholiday",   ["family"],                 []),
    ("wellness",        ["wellness"],               []),
    ("wildlife",        ["wildlife", "adventure"],  []),
    ("roadtrip",        ["road trip"],              []),
]

# Instagram Basic Display API endpoints
IG_AUTH_URL = "https://api.instagram.com/oauth/authorize"
IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
IG_GRAPH_URL = "https://graph.instagram.com"
IG_SCOPES = "user_profile,user_media"


def _run_ytdlp(url: str, max_results: int = 10) -> list[dict]:
    """Run yt-dlp in flat-playlist / dump-json mode."""
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
        logger.warning("yt-dlp timed out for %s", url)
        return []
    except FileNotFoundError:
        logger.warning("yt-dlp not found in PATH — skipping Instagram seeding")
        return []
    except Exception as exc:
        logger.warning("yt-dlp error for %s: %s", url, exc)
        return []


def search_instagram_by_hashtag(hashtag: str, max_results: int = 10) -> list[dict]:
    """Fetch Instagram Reels/posts from a public hashtag page via yt-dlp."""
    tag = hashtag.lstrip("#")
    url = f"https://www.instagram.com/explore/tags/{tag}/"
    return _run_ytdlp(url, max_results=max_results)


def instagram_raw_to_payload(
    data: dict,
    travel_styles: list[str] | None = None,
    destinations: list[str] | None = None,
) -> dict | None:
    """
    Convert a raw yt-dlp Instagram video dict into a vlog table insert payload.
    Returns None if required fields are absent.
    """
    video_id = (
        data.get("id")
        or data.get("shortcode")
        or data.get("display_id")
        or data.get("webpage_url_basename")
    )
    if not video_id:
        return None

    url = (
        data.get("webpage_url")
        or data.get("url")
        or f"https://www.instagram.com/p/{video_id}/"
    )

    thumbnail = data.get("thumbnail")
    if not thumbnail:
        thumbs = data.get("thumbnails") or []
        thumbnail = thumbs[0].get("url") if thumbs else None

    title = (data.get("title") or data.get("description") or "Instagram Travel Reel")[:500]
    description = (data.get("description") or "")[:2000]
    uploader = (
        data.get("uploader")
        or data.get("owner_username")
        or data.get("channel")
        or "Instagram Creator"
    )
    channel_id = data.get("uploader_id") or data.get("owner_id") or data.get("channel_id") or ""
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
        "platform": "instagram",
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


def seed_instagram_travel_content(db, max_per_hashtag: int = 8) -> int:
    """
    Iterate over INSTAGRAM_SEED_HASHTAGS, fetch Reels via yt-dlp, and insert
    new rows into the vlogs table.  Skips already-existing rows.
    Returns the count of newly inserted vlogs.
    """
    inserted = 0
    for hashtag, styles, dests in INSTAGRAM_SEED_HASHTAGS:
        try:
            raw_videos = search_instagram_by_hashtag(hashtag, max_results=max_per_hashtag)
            for raw in raw_videos:
                payload = instagram_raw_to_payload(raw, travel_styles=styles, destinations=dests)
                if not payload:
                    continue

                exists = (
                    db.table("vlogs")
                    .select("id")
                    .eq("platform_video_id", payload["platform_video_id"])
                    .eq("platform", "instagram")
                    .execute()
                )
                if exists.data:
                    continue

                db.table("vlogs").insert(payload).execute()
                inserted += 1

        except Exception as exc:
            logger.warning("Instagram seed failed for #%s: %s", hashtag, exc)

    logger.info("Instagram seeding complete: %d vlogs inserted", inserted)
    return inserted


def build_instagram_oauth_url(client_id: str, redirect_uri: str, state: str) -> str:
    """Build the Instagram Basic Display API OAuth authorisation URL."""
    from urllib.parse import urlencode
    params = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": IG_SCOPES,
        "response_type": "code",
        "state": state,
    })
    return f"{IG_AUTH_URL}?{params}"


async def exchange_instagram_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """
    Exchange an Instagram authorisation code for a short-lived access token.
    Returns the full token response dict (contains access_token, user_id).
    """
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            IG_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_instagram_user_info(access_token: str) -> dict:
    """Fetch basic profile info (id, username) for the authenticated user."""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{IG_GRAPH_URL}/me",
            params={"fields": "id,username", "access_token": access_token},
        )
        resp.raise_for_status()
        return resp.json()


async def ingest_instagram_user_media(
    db,
    user_id: str,
    access_token: str,
    ig_user_id: str,
) -> list[str]:
    """
    Fetch the authenticated user's Instagram media (Reels/videos) and insert
    new ones into the vlogs table.  Returns list of newly inserted vlog IDs.
    """
    import httpx
    new_ids: list[str] = []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{IG_GRAPH_URL}/{ig_user_id}/media",
                params={
                    "fields": "id,media_type,media_url,thumbnail_url,timestamp,caption,username",
                    "access_token": access_token,
                },
            )
            resp.raise_for_status()
            media_list = resp.json().get("data", [])

        for item in media_list:
            if item.get("media_type") not in ("VIDEO", "REEL"):
                continue

            video_id = item.get("id")
            if not video_id:
                continue

            exists = (
                db.table("vlogs")
                .select("id")
                .eq("platform_video_id", video_id)
                .eq("platform", "instagram")
                .execute()
            )
            if exists.data:
                continue

            timestamp = item.get("timestamp")
            try:
                published_at = (
                    datetime.fromisoformat(timestamp.replace("Z", "+00:00")).isoformat()
                    if timestamp
                    else None
                )
            except Exception:
                published_at = None

            insert_resp = db.table("vlogs").insert({
                "platform": "instagram",
                "platform_video_id": video_id,
                "title": (item.get("caption") or "Instagram Reel")[:500],
                "description": item.get("caption", "")[:2000],
                "thumbnail_url": item.get("thumbnail_url") or item.get("media_url"),
                "video_url": item.get("media_url"),
                "channel_name": item.get("username", ""),
                "channel_id": ig_user_id,
                "published_at": published_at,
                "processing_status": "ready",
                "raw_transcript": item.get("caption", ""),
                "destinations": [],
                "travel_styles": [],
            }).execute()

            if insert_resp.data:
                new_ids.append(insert_resp.data[0]["id"])

    except Exception as exc:
        logger.warning("Instagram media ingest failed for user %s: %s", user_id, exc)

    return new_ids
