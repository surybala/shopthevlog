"""
YouTube Data API v3 integration.

Fetches channel videos, captions, and handles OAuth token refresh.
Falls back to yt-dlp for auto-generated captions unavailable via API.
"""
import logging
from typing import Optional
from datetime import datetime
from dataclasses import dataclass

import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from app.core.config import settings
from app.db.client import get_supabase

logger = logging.getLogger(__name__)


@dataclass
class VlogMetadata:
    platform: str
    platform_video_id: str
    title: str
    description: Optional[str]
    thumbnail_url: Optional[str]
    video_url: Optional[str]
    channel_name: Optional[str]
    channel_id: Optional[str]
    duration_seconds: Optional[int]
    published_at: Optional[datetime]
    view_count: Optional[int]
    like_count: Optional[int]
    language: str = "en"


def _build_youtube_client(access_token: str, refresh_token: str):
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.YOUTUBE_CLIENT_ID,
        client_secret=settings.YOUTUBE_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/youtube.readonly"],
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("youtube", "v3", credentials=creds, cache_discovery=False), creds


def _iso_duration_to_seconds(iso: str) -> int:
    """Convert ISO 8601 duration (PT1H2M3S) to seconds."""
    import re
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso)
    if not match:
        return 0
    h, m, s = (int(x) if x else 0 for x in match.groups())
    return h * 3600 + m * 60 + s


def fetch_channel_videos(channel_id: str, access_token: str, refresh_token: str) -> list[VlogMetadata]:
    """Fetch uploads from a YouTube channel using the OAuth'd user's access."""
    try:
        yt, _ = _build_youtube_client(access_token, refresh_token)

        # Get uploads playlist ID
        channels_resp = yt.channels().list(part="contentDetails", id=channel_id).execute()
        if not channels_resp.get("items"):
            return []
        uploads_playlist = channels_resp["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

        # Fetch videos from uploads playlist
        videos = []
        next_page = None
        while len(videos) < 50:
            playlist_resp = yt.playlistItems().list(
                part="snippet,contentDetails",
                playlistId=uploads_playlist,
                maxResults=50,
                pageToken=next_page,
            ).execute()

            video_ids = [item["contentDetails"]["videoId"] for item in playlist_resp.get("items", [])]
            if not video_ids:
                break

            details_resp = yt.videos().list(
                part="snippet,contentDetails,statistics",
                id=",".join(video_ids),
            ).execute()

            for video in details_resp.get("items", []):
                snippet = video.get("snippet", {})
                stats = video.get("statistics", {})
                content = video.get("contentDetails", {})

                # Filter to travel-relevant videos (category 19 = Travel & Events)
                if snippet.get("categoryId") not in ("19", "22", ""):  # 22 = People & Blogs (vlogs)
                    pass  # Include all for now; filter by Claude destination extraction later

                thumbnails = snippet.get("thumbnails", {})
                thumb = (thumbnails.get("maxres") or thumbnails.get("high") or thumbnails.get("default") or {}).get("url")

                published_raw = snippet.get("publishedAt")
                published_at = datetime.fromisoformat(published_raw.replace("Z", "+00:00")) if published_raw else None

                videos.append(VlogMetadata(
                    platform="youtube",
                    platform_video_id=video["id"],
                    title=snippet.get("title", ""),
                    description=snippet.get("description"),
                    thumbnail_url=thumb,
                    video_url=f"https://www.youtube.com/watch?v={video['id']}",
                    channel_name=snippet.get("channelTitle"),
                    channel_id=snippet.get("channelId"),
                    duration_seconds=_iso_duration_to_seconds(content.get("duration", "PT0S")),
                    published_at=published_at,
                    view_count=int(stats.get("viewCount", 0)) or None,
                    like_count=int(stats.get("likeCount", 0)) or None,
                ))

            next_page = playlist_resp.get("nextPageToken")
            if not next_page:
                break

        return videos
    except Exception as e:
        logger.error(f"fetch_channel_videos error: {e}")
        return []


def search_travel_vlogs(query: str, max_results: int = 20) -> list[VlogMetadata]:
    """Search public YouTube for travel vlogs using the API key (no OAuth needed)."""
    try:
        yt = build("youtube", "v3", developerKey=settings.YOUTUBE_API_KEY, cache_discovery=False)
        search_resp = yt.search().list(
            part="snippet",
            q=f"{query} travel vlog",
            type="video",
            videoCategoryId="19",
            maxResults=max_results,
            order="viewCount",
        ).execute()

        video_ids = [item["id"]["videoId"] for item in search_resp.get("items", [])]
        if not video_ids:
            return []

        details_resp = yt.videos().list(
            part="snippet,contentDetails,statistics",
            id=",".join(video_ids),
        ).execute()

        results = []
        for video in details_resp.get("items", []):
            snippet = video.get("snippet", {})
            stats = video.get("statistics", {})
            content = video.get("contentDetails", {})
            thumbnails = snippet.get("thumbnails", {})
            thumb = (thumbnails.get("maxres") or thumbnails.get("high") or {}).get("url")
            published_raw = snippet.get("publishedAt")
            published_at = datetime.fromisoformat(published_raw.replace("Z", "+00:00")) if published_raw else None

            results.append(VlogMetadata(
                platform="youtube",
                platform_video_id=video["id"],
                title=snippet.get("title", ""),
                description=snippet.get("description"),
                thumbnail_url=thumb,
                video_url=f"https://www.youtube.com/watch?v={video['id']}",
                channel_name=snippet.get("channelTitle"),
                channel_id=snippet.get("channelId"),
                duration_seconds=_iso_duration_to_seconds(content.get("duration", "PT0S")),
                published_at=published_at,
                view_count=int(stats.get("viewCount", 0)) or None,
                like_count=int(stats.get("likeCount", 0)) or None,
            ))
        return results
    except Exception as e:
        logger.error(f"search_travel_vlogs error: {e}")
        return []


def get_video_captions(video_id: str) -> Optional[str]:
    """
    Try to get captions via yt-dlp (handles auto-generated captions too).
    Returns plain text transcript or None.
    """
    try:
        import yt_dlp
        import tempfile, os

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

            # Find any .vtt file
            for fname in os.listdir(tmpdir):
                if fname.endswith(".vtt"):
                    with open(os.path.join(tmpdir, fname), "r", encoding="utf-8") as f:
                        raw_vtt = f.read()
                    return _parse_vtt(raw_vtt)
        return None
    except Exception as e:
        logger.warning(f"get_video_captions failed for {video_id}: {e}")
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
        # Remove HTML tags
        clean = re.sub(r"<[^>]+>", "", line)
        if clean:
            text_lines.append(clean)
    # Deduplicate consecutive duplicate lines (common in auto-captions)
    deduped = []
    prev = None
    for line in text_lines:
        if line != prev:
            deduped.append(line)
        prev = line
    return " ".join(deduped)


def get_user_subscriptions(user_id: str) -> set[str]:
    """
    Return the set of YouTube channel IDs the user subscribes to.
    Returns an empty set if the user hasn't connected YouTube or on any API error.
    Caps at 500 subscriptions to avoid excessive API usage.
    """
    db = get_supabase()
    conn_resp = (
        db.table("social_connections")
        .select("access_token,refresh_token")
        .eq("user_id", user_id)
        .eq("platform", "youtube")
        .execute()
    )
    if not conn_resp.data:
        return set()

    conn = conn_resp.data[0]
    try:
        yt, _ = _build_youtube_client(conn["access_token"], conn["refresh_token"])
        channel_ids: set[str] = set()
        next_page = None
        while len(channel_ids) < 500:
            resp = yt.subscriptions().list(
                part="snippet",
                mine=True,
                maxResults=50,
                pageToken=next_page,
            ).execute()
            for item in resp.get("items", []):
                cid = item.get("snippet", {}).get("resourceId", {}).get("channelId")
                if cid:
                    channel_ids.add(cid)
            next_page = resp.get("nextPageToken")
            if not next_page:
                break
        logger.info(f"Loaded {len(channel_ids)} YouTube subscriptions for user {user_id}")
        return channel_ids
    except Exception as e:
        logger.warning(f"get_user_subscriptions failed for user {user_id}: {e}")
        return set()


async def ingest_new_vlogs_for_user(user_id: str) -> list[str]:
    """
    Fetch new vlogs from all of a user's connected YouTube channels,
    dedupe against the DB, insert new rows, and return new vlog IDs.
    """
    db = get_supabase()

    # Load connected YouTube account
    conn_resp = db.table("social_connections").select("*").eq("user_id", user_id).eq("platform", "youtube").execute()
    if not conn_resp.data:
        return []

    conn = conn_resp.data[0]
    access_token = conn.get("access_token", "")
    refresh_token = conn.get("refresh_token", "")
    channel_id = conn.get("platform_user_id", "")

    videos = fetch_channel_videos(channel_id, access_token, refresh_token)

    new_vlog_ids = []
    for v in videos:
        # Check if already exists
        exists = db.table("vlogs").select("id").eq("platform_video_id", v.platform_video_id).eq("platform", "youtube").execute()
        if exists.data:
            continue

        insert_resp = db.table("vlogs").insert({
            "platform": "youtube",
            "platform_video_id": v.platform_video_id,
            "title": v.title,
            "description": v.description,
            "thumbnail_url": v.thumbnail_url,
            "video_url": v.video_url,
            "channel_name": v.channel_name,
            "channel_id": v.channel_id,
            "duration_seconds": v.duration_seconds,
            "published_at": v.published_at.isoformat() if v.published_at else None,
            "view_count": v.view_count,
            "like_count": v.like_count,
            "processing_status": "pending",
        }).execute()

        if insert_resp.data:
            new_vlog_ids.append(insert_resp.data[0]["id"])

    return new_vlog_ids
