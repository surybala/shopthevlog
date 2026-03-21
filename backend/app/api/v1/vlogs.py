from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from typing import Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.vlog import VlogResponse, VlogStatusResponse
from app.tasks.process_vlog import process_vlog_task

router = APIRouter(prefix="/vlogs", tags=["vlogs"])


@router.get("/search")
async def search_vlogs(
    q: str = Query(..., min_length=2),
    limit: int = Query(20, ge=1, le=50),
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()
    resp = (
        db.table("vlogs")
        .select("*")
        .ilike("title", f"%{q}%")
        .eq("processing_status", "ready")
        .limit(limit)
        .execute()
    )
    return resp.data or []


@router.get("/{vlog_id}/status", response_model=VlogStatusResponse)
async def get_vlog_status(vlog_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    vlog_resp = db.table("vlogs").select("processing_status").eq("id", vlog_id).single().execute()
    if not vlog_resp.data:
        raise HTTPException(status_code=404, detail="Vlog not found")

    status = vlog_resp.data["processing_status"]
    itinerary_id = None

    if status == "ready":
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None

    return VlogStatusResponse(status=status, itinerary_id=itinerary_id)


@router.get("/{vlog_id}")
async def get_vlog(vlog_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("vlogs").select("*").eq("id", vlog_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Vlog not found")

    vlog = resp.data
    itinerary_id = None
    if vlog["processing_status"] == "ready":
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None

    return {**vlog, "itinerary_id": itinerary_id}


@router.post("/ingest")
async def ingest_vlog(
    background_tasks: BackgroundTasks,
    url: str = Query(...),
    user: UserClaims = Depends(get_current_user),
):
    """Manually queue a YouTube URL for processing."""
    import re
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    video_id = match.group(1)
    db = get_supabase()

    # Check if exists
    exists = db.table("vlogs").select("id,processing_status").eq("platform_video_id", video_id).eq("platform", "youtube").execute()
    if exists.data:
        vlog = exists.data[0]
        if vlog["processing_status"] in ("pending", "transcribing", "planning"):
            return {"vlog_id": vlog["id"], "status": "already_processing"}
        return {"vlog_id": vlog["id"], "status": vlog["processing_status"]}

    # Insert stub
    insert_resp = db.table("vlogs").insert({
        "platform": "youtube",
        "platform_video_id": video_id,
        "title": f"YouTube video {video_id}",
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "processing_status": "pending",
    }).execute()

    vlog_id = insert_resp.data[0]["id"]
    background_tasks.add_task(process_vlog_task, vlog_id)

    return {"vlog_id": vlog_id, "status": "queued"}
