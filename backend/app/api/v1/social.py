import logging
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from google_auth_oauthlib.flow import Flow

from app.core.security import get_current_user, UserClaims
from app.core.config import settings
from app.db.client import get_supabase
from app.services.youtube_service import search_travel_vlogs
from app.services.feed_ranking_service import build_feed_for_user

logger = logging.getLogger(__name__)

# ── TikTok Login Kit v2 ────────────────────────────────────────────────────────
_TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
_TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
_TIKTOK_USER_URL = "https://open.tiktokapis.com/v2/user/info/"
_TIKTOK_SCOPES = "user.info.basic,video.list"

# ── Instagram Basic Display API ────────────────────────────────────────────────
_IG_AUTH_URL = "https://api.instagram.com/oauth/authorize"
_IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
_IG_GRAPH_URL = "https://graph.instagram.com"
_IG_SCOPES = "user_profile,user_media"

_POPUP_SUCCESS = (
    "<script>window.opener?.postMessage({type:'%s_connect',success:true},'*');"
    "window.close();</script>"
)
_POPUP_FAILURE = (
    "<script>window.opener?.postMessage({type:'%s_connect',success:false},'*');"
    "window.close();</script>"
)

# Each entry: (search_query, destinations[], travel_styles[])
# Destinations and styles are stored on the vlog row so filters work immediately,
# before the async AI pipeline has had a chance to classify the video.
SEED_QUERIES = [
    ("Japan travel vlog 2024",          ["Japan"],                              ["cultural"]),
    ("Bali Indonesia travel vlog",      ["Bali", "Indonesia"],                  ["adventure", "beach"]),
    ("Europe backpacking trip",         ["Europe"],                             ["backpacking", "budget"]),
    ("New York City travel guide",      ["New York City", "USA"],               ["city break"]),
    ("Southeast Asia travel vlog",      ["Thailand", "Vietnam", "Cambodia"],    ["backpacking", "budget"]),
    ("Thailand travel 2024",            ["Thailand"],                           ["adventure", "cultural"]),
    ("Italy travel vlog",               ["Italy"],                              ["cultural", "food & culinary"]),
    ("Morocco travel vlog",             ["Morocco"],                            ["cultural", "adventure"]),
    ("luxury resort travel vlog",       [],                                     ["luxury"]),
    ("solo female travel vlog",         [],                                     ["solo"]),
    ("family vacation travel vlog",     [],                                     ["family"]),
    ("hiking mountain adventure vlog",  [],                                     ["mountain", "adventure"]),
    ("beach vacation travel vlog",      [],                                     ["beach"]),
    ("food travel vlog street food",    [],                                     ["food & culinary"]),
    ("road trip USA travel vlog",       ["USA"],                                ["road trip"]),
    ("wildlife safari Africa vlog",     ["Africa"],                             ["wildlife", "adventure"]),
]


def _insert_vlog_if_new(db, v, destinations: list, travel_styles: list) -> bool:
    """Insert a vlog if not already in DB. Returns True if inserted."""
    exists = (
        db.table("vlogs")
        .select("id")
        .eq("platform_video_id", v.platform_video_id)
        .eq("platform", "youtube")
        .execute()
    )
    if exists.data:
        return False
    db.table("vlogs").insert({
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
        # Marked ready immediately so the feed ranking picks them up.
        # The AI pipeline can enrich destinations/styles later.
        "processing_status": "ready",
        "raw_transcript": v.description or v.title,
        "destinations": destinations,
        "travel_styles": travel_styles,
    }).execute()
    return True


async def _seed_public_travel_vlogs(db) -> int:
    """
    Search public YouTube for popular travel vlogs and insert them as ready
    so the discovery feed has content immediately after a user connects.
    Vlogs are tagged with destinations and travel_styles from the query context
    so filters work before AI classification completes.
    Returns the number of newly inserted vlogs.
    """
    inserted = 0
    for query, destinations, travel_styles in SEED_QUERIES:
        try:
            public_vlogs = search_travel_vlogs(query, max_results=10)
            for v in public_vlogs:
                if _insert_vlog_if_new(db, v, destinations, travel_styles):
                    inserted += 1
        except Exception as e:
            logger.warning(f"Seed query '{query}' failed: {e}")

    logger.info(f"Seeded {inserted} public travel vlogs")
    return inserted


async def _seed_for_user_interests(
    user_id: str,
    travel_styles: list,
    dest_prefs: list,
) -> None:
    """
    Seed YouTube content matched to a user's stated travel interests and
    preferred destinations, then rebuild their personalised feed.
    Called as a background task when the user saves their preferences.
    """
    db = get_supabase()
    queries: list[tuple[str, list, list]] = []

    for style in travel_styles[:6]:
        queries.append((f"{style} travel vlog", [], [style.lower()]))
    for dest in dest_prefs[:4]:
        queries.append((f"{dest} travel vlog", [dest], []))

    for query, destinations, styles in queries:
        try:
            vlogs = search_travel_vlogs(query, max_results=10)
            for v in vlogs:
                _insert_vlog_if_new(db, v, destinations, styles)
        except Exception as e:
            logger.warning(f"Interest seed query '{query}' failed: {e}")

    build_feed_for_user(user_id)
    logger.info(f"Seeded interests-based vlogs and rebuilt feed for user {user_id}")


async def _seed_and_build_feed(db, user_id: str) -> None:
    """Background helper: seed public vlogs (YouTube + TikTok + Instagram) then build the user's feed."""
    from app.services.tiktok_service import seed_tiktok_travel_content
    from app.services.instagram_service import seed_instagram_travel_content

    try:
        if settings.YOUTUBE_API_KEY:
            await _seed_public_travel_vlogs(db)
        else:
            logger.warning("YOUTUBE_API_KEY not set — skipping YouTube vlog seeding")

        # Seed TikTok and Instagram public hashtag content (no API key needed)
        try:
            seed_tiktok_travel_content(db, max_per_hashtag=6)
        except Exception as e:
            logger.warning(f"TikTok seeding failed: {e}")

        try:
            seed_instagram_travel_content(db, max_per_hashtag=6)
        except Exception as e:
            logger.warning(f"Instagram seeding failed: {e}")

        build_feed_for_user(user_id)
        logger.info(f"Feed seeded and built for user {user_id}")
    except Exception as e:
        logger.exception(f"_seed_and_build_feed failed for user {user_id}: {e}")

router = APIRouter(prefix="/social", tags=["social"])

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


def _make_youtube_flow() -> Flow:
    client_config = {
        "web": {
            "client_id": settings.YOUTUBE_CLIENT_ID,
            "client_secret": settings.YOUTUBE_CLIENT_SECRET,
            "redirect_uris": [settings.YOUTUBE_REDIRECT_URI],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=YOUTUBE_SCOPES,
        redirect_uri=settings.YOUTUBE_REDIRECT_URI,
    )


@router.get("/connect/youtube")
async def connect_youtube(user: UserClaims = Depends(get_current_user)):
    """Returns the Google OAuth URL for YouTube scope."""
    flow = _make_youtube_flow()
    # Pass user_id as `state` directly to authorization_url — setting flow.state
    # after construction does NOT propagate into the generated URL.
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=user.user_id,
    )
    return {"url": auth_url}


@router.get("/connect/youtube/callback")
async def youtube_callback(request: Request):
    """Handle Google OAuth callback, store tokens, trigger vlog ingest."""
    from app.tasks.process_vlog import process_vlog_task
    from app.services.youtube_service import ingest_new_vlogs_for_user
    import asyncio

    code = request.query_params.get("code")
    state = request.query_params.get("state")  # user_id
    error = request.query_params.get("error")

    if error or not code or not state:
        return HTMLResponse(
            "<script>window.opener?.postMessage({type:'yt_connect',success:false},'*');window.close();</script>"
        )

    try:
        flow = _make_youtube_flow()
        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Get channel info
        from googleapiclient.discovery import build as gapi_build
        yt = gapi_build("youtube", "v3", credentials=credentials, cache_discovery=False)
        channel_resp = yt.channels().list(part="snippet", mine=True).execute()
        channel = channel_resp["items"][0] if channel_resp.get("items") else {}
        channel_id = channel.get("id", "")
        username = channel.get("snippet", {}).get("customUrl") or channel.get("snippet", {}).get("title", "")

        db = get_supabase()
        db.table("social_connections").upsert({
            "user_id": state,
            "platform": "youtube",
            "platform_user_id": channel_id,
            "platform_username": username,
            "access_token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "token_expires_at": credentials.expiry.isoformat() if credentials.expiry else None,
            "scopes": list(credentials.scopes) if credentials.scopes else YOUTUBE_SCOPES,
        }, on_conflict="user_id,platform").execute()

        # Kick off vlog ingest from the user's own channel asynchronously
        new_ids = await ingest_new_vlogs_for_user(state)
        for vlog_id in new_ids:
            asyncio.create_task(process_vlog_task(vlog_id))

        # Seed discovery feed + build feed in the background (don't block the popup)
        asyncio.create_task(_seed_and_build_feed(db, state))

    except Exception as e:
        import traceback
        err_detail = traceback.format_exc()
        logger.exception(f"YouTube callback error: {e}")
        # Show the error in the popup so we can diagnose it
        safe_err = str(e).replace("`", "'").replace('"', "'")
        return HTMLResponse(f"""
            <html><body style="font-family:monospace;background:#1a1a2e;color:#e94560;padding:20px">
            <h3>YouTube OAuth Error (dev only)</h3>
            <pre style="white-space:pre-wrap;font-size:12px;color:#fff">{err_detail[:3000]}</pre>
            <button onclick="window.close()" style="margin-top:16px;padding:8px 16px">Close</button>
            </body></html>
        """)

    return HTMLResponse(
        "<script>window.opener?.postMessage({type:'yt_connect',success:true},'*');window.close();</script>"
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TikTok OAuth (Login Kit v2)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/connect/tiktok")
async def connect_tiktok(user: UserClaims = Depends(get_current_user)):
    """Returns the TikTok Login Kit v2 authorisation URL."""
    if not settings.TIKTOK_CLIENT_KEY:
        from fastapi import HTTPException
        raise HTTPException(status_code=501, detail="TikTok integration not configured")

    params = urlencode({
        "client_key": settings.TIKTOK_CLIENT_KEY,
        "response_type": "code",
        "scope": _TIKTOK_SCOPES,
        "redirect_uri": settings.TIKTOK_REDIRECT_URI,
        "state": user.user_id,
    })
    return {"url": f"{_TIKTOK_AUTH_URL}?{params}"}


@router.get("/connect/tiktok/callback")
async def tiktok_callback(request: Request):
    """Handle TikTok OAuth callback, store tokens, trigger content ingest."""
    import asyncio

    code = request.query_params.get("code")
    state = request.query_params.get("state")   # user_id
    error = request.query_params.get("error")

    if error or not code or not state:
        return HTMLResponse(_POPUP_FAILURE % "tiktok")

    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                _TIKTOK_TOKEN_URL,
                json={
                    "client_key": settings.TIKTOK_CLIENT_KEY,
                    "client_secret": settings.TIKTOK_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.TIKTOK_REDIRECT_URI,
                },
                headers={"Content-Type": "application/json"},
            )
            token_data = token_resp.json().get("data", {})

        access_token = token_data.get("access_token", "")
        open_id = token_data.get("open_id", "")

        # Fetch TikTok display name
        display_name = ""
        if access_token and open_id:
            async with httpx.AsyncClient() as client:
                user_resp = await client.get(
                    _TIKTOK_USER_URL,
                    params={"fields": "open_id,display_name,avatar_url"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                user_data = user_resp.json().get("data", {}).get("user", {})
                display_name = user_data.get("display_name", "")

        db = get_supabase()
        db.table("social_connections").upsert({
            "user_id": state,
            "platform": "tiktok",
            "platform_user_id": open_id,
            "platform_username": display_name,
            "access_token": access_token,
        }, on_conflict="user_id,platform").execute()

        # Rebuild this user's feed in background
        asyncio.create_task(_seed_and_build_feed(db, state))

    except Exception as e:
        logger.exception(f"TikTok callback error: {e}")
        return HTMLResponse(_POPUP_FAILURE % "tiktok")

    return HTMLResponse(_POPUP_SUCCESS % "tiktok")


# ═══════════════════════════════════════════════════════════════════════════════
# Instagram OAuth (Basic Display API)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/connect/instagram")
async def connect_instagram(user: UserClaims = Depends(get_current_user)):
    """Returns the Instagram Basic Display API authorisation URL."""
    if not settings.INSTAGRAM_CLIENT_ID:
        from fastapi import HTTPException
        raise HTTPException(status_code=501, detail="Instagram integration not configured")

    params = urlencode({
        "client_id": settings.INSTAGRAM_CLIENT_ID,
        "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
        "scope": _IG_SCOPES,
        "response_type": "code",
        "state": user.user_id,
    })
    return {"url": f"{_IG_AUTH_URL}?{params}"}


@router.get("/connect/instagram/callback")
async def instagram_callback(request: Request):
    """Handle Instagram OAuth callback, store tokens, ingest user's Reels."""
    import asyncio
    from app.services.instagram_service import get_instagram_user_info, ingest_instagram_user_media

    code = request.query_params.get("code")
    state = request.query_params.get("state")   # user_id
    error = request.query_params.get("error")

    if error or not code or not state:
        return HTMLResponse(_POPUP_FAILURE % "instagram")

    try:
        # Exchange code for short-lived token
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                _IG_TOKEN_URL,
                data={
                    "client_id": settings.INSTAGRAM_CLIENT_ID,
                    "client_secret": settings.INSTAGRAM_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
                    "code": code,
                },
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()

        access_token = token_data.get("access_token", "")
        ig_user_id = str(token_data.get("user_id", ""))

        # Get username
        user_info = await get_instagram_user_info(access_token)
        username = user_info.get("username", "")

        db = get_supabase()
        db.table("social_connections").upsert({
            "user_id": state,
            "platform": "instagram",
            "platform_user_id": ig_user_id,
            "platform_username": username,
            "access_token": access_token,
        }, on_conflict="user_id,platform").execute()

        # Ingest user's Reels + rebuild feed in background
        async def _ingest_and_build():
            await ingest_instagram_user_media(db, state, access_token, ig_user_id)
            build_feed_for_user(state)

        asyncio.create_task(_ingest_and_build())

    except Exception as e:
        logger.exception(f"Instagram callback error: {e}")
        return HTMLResponse(_POPUP_FAILURE % "instagram")

    return HTMLResponse(_POPUP_SUCCESS % "instagram")


# ═══════════════════════════════════════════════════════════════════════════════

@router.delete("/connect/{platform}")
async def disconnect_social(platform: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    db.table("social_connections").delete().eq("user_id", user.user_id).eq("platform", platform).execute()
    return {"ok": True}


@router.get("/status")
async def social_status(user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("social_connections").select("id,platform,platform_username,connected_at").eq("user_id", user.user_id).execute()
    return resp.data or []
