from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from google_auth_oauthlib.flow import Flow

from app.core.security import get_current_user, UserClaims
from app.core.config import settings
from app.db.client import get_supabase

router = APIRouter(prefix="/social", tags=["social"])

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


def _make_youtube_flow(state: str | None = None) -> Flow:
    client_config = {
        "web": {
            "client_id": settings.YOUTUBE_CLIENT_ID,
            "client_secret": settings.YOUTUBE_CLIENT_SECRET,
            "redirect_uris": [settings.YOUTUBE_REDIRECT_URI],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    flow = Flow.from_client_config(
        client_config,
        scopes=YOUTUBE_SCOPES,
        redirect_uri=settings.YOUTUBE_REDIRECT_URI,
    )
    if state:
        flow.state = state
    return flow


@router.get("/connect/youtube")
async def connect_youtube(user: UserClaims = Depends(get_current_user)):
    """Returns the Google OAuth URL for YouTube scope."""
    flow = _make_youtube_flow(state=user.user_id)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
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

        # Kick off vlog ingest asynchronously
        new_ids = await ingest_new_vlogs_for_user(state)
        for vlog_id in new_ids:
            asyncio.create_task(process_vlog_task(vlog_id))

    except Exception:
        pass  # Don't expose errors to the popup

    return HTMLResponse(
        "<script>window.opener?.postMessage({type:'yt_connect',success:true},'*');window.close();</script>"
    )


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
