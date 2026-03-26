from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from typing import Optional
from datetime import datetime, timezone, timedelta

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.vlog import VlogResponse, VlogStatusResponse
from app.tasks.process_vlog import process_vlog_task

STUCK_TASK_THRESHOLD = timedelta(minutes=10)  # must exceed local Whisper timeout (5 min) + overhead

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


def _is_stuck(updated_at_str: str | None) -> bool:
    """Return True if updated_at is older than STUCK_TASK_THRESHOLD."""
    if not updated_at_str:
        return True
    try:
        updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - updated_at) > STUCK_TASK_THRESHOLD
    except Exception:
        return True


@router.get("/{vlog_id}/status", response_model=VlogStatusResponse)
async def get_vlog_status(
    vlog_id: str,
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()

    vlog_resp = db.table("vlogs").select("processing_status, updated_at").eq("id", vlog_id).single().execute()
    if not vlog_resp.data:
        raise HTTPException(status_code=404, detail="Vlog not found")

    status = vlog_resp.data["processing_status"]
    updated_at = vlog_resp.data.get("updated_at")
    itinerary_id = None

    if status == "ready":
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None
        # No auto-queue here — user must explicitly click "Plan this vlog"

    elif status in ("planning", "transcribing"):
        # Re-queue only if the task appears stuck (server restart killed in-flight task).
        # This handles the case where the user already clicked Plan but the worker died.
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None

        if not itinerary_id and _is_stuck(updated_at):
            import logging
            logging.getLogger(__name__).warning(
                f"Vlog {vlog_id} stuck in '{status}' since {updated_at}, re-queuing"
            )
            db.table("vlogs").update({"processing_status": "planning"}).eq("id", vlog_id).execute()
            status = "planning"
            background_tasks.add_task(process_vlog_task, vlog_id)

    return VlogStatusResponse(status=status, itinerary_id=itinerary_id)


@router.get("/{vlog_id}")
async def get_vlog(
    vlog_id: str,
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()
    resp = db.table("vlogs").select("*").eq("id", vlog_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Vlog not found")

    vlog = resp.data
    itinerary_id = None
    status = vlog["processing_status"]

    if status in ("ready", "failed"):
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None
        # No auto-queue — user triggers planning explicitly via POST /{vlog_id}/plan

    elif status in ("planning", "transcribing"):
        # Re-queue only if stuck (server restart killed the background task)
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        itinerary_id = itin_resp.data[0]["id"] if itin_resp.data else None

        if not itinerary_id and _is_stuck(vlog.get("updated_at")):
            db.table("vlogs").update({"processing_status": "planning"}).eq("id", vlog_id).execute()
            vlog["processing_status"] = "planning"
            background_tasks.add_task(process_vlog_task, vlog_id)

    return {**vlog, "itinerary_id": itinerary_id}


@router.post("/{vlog_id}/plan")
async def plan_vlog(
    vlog_id: str,
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    """
    Explicitly trigger itinerary generation.
    Works for seeded vlogs (ready, no itinerary) and failed vlogs (retry).
    Safe to call multiple times — ignores if already processing or done.
    """
    db = get_supabase()

    vlog_resp = db.table("vlogs").select("processing_status").eq("id", vlog_id).single().execute()
    if not vlog_resp.data:
        raise HTTPException(status_code=404, detail="Vlog not found")

    status = vlog_resp.data["processing_status"]

    # Already running
    if status in ("planning", "transcribing"):
        return {"status": "already_processing"}

    # Already done
    if status == "ready":
        itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
        if itin_resp.data:
            return {"status": "already_done", "itinerary_id": itin_resp.data[0]["id"]}

    # Queue the pipeline (covers: ready+no-itinerary, failed, pending)
    db.table("vlogs").update({"processing_status": "planning"}).eq("id", vlog_id).execute()
    background_tasks.add_task(process_vlog_task, vlog_id)
    return {"status": "queued"}


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
