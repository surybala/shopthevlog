from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.itinerary import ItineraryResponse, RegenerateRequest
from app.tasks.process_vlog import process_vlog_task

router = APIRouter(prefix="/itineraries", tags=["itineraries"])


@router.get("/{itinerary_id}", response_model=ItineraryResponse)
async def get_itinerary(itinerary_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    itin_resp = db.table("itineraries").select("*").eq("id", itinerary_id).single().execute()
    if not itin_resp.data:
        raise HTTPException(status_code=404, detail="Itinerary not found")

    itinerary = itin_resp.data

    # Fetch days
    days_resp = db.table("itinerary_days").select("*").eq("itinerary_id", itinerary_id).order("day_number").execute()
    days = days_resp.data or []

    # Fetch activities for each day
    for day in days:
        acts_resp = db.table("itinerary_activities").select("*").eq("day_id", day["id"]).order("order_index").execute()
        day["activities"] = acts_resp.data or []

    itinerary["days"] = days
    return itinerary


@router.post("/{vlog_id}/regenerate")
async def regenerate_itinerary(
    vlog_id: str,
    body: RegenerateRequest,
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()

    # Delete existing itinerary
    itin_resp = db.table("itineraries").select("id").eq("vlog_id", vlog_id).execute()
    for itin in (itin_resp.data or []):
        db.table("itineraries").delete().eq("id", itin["id"]).execute()

    # Reset vlog status
    db.table("vlogs").update({"processing_status": "pending", "raw_transcript": None}).eq("id", vlog_id).execute()

    background_tasks.add_task(process_vlog_task, vlog_id)
    return {"ok": True, "message": "Regeneration queued"}


@router.patch("/{itinerary_id}/activities/{activity_id}")
async def update_activity(
    itinerary_id: str,
    activity_id: str,
    body: dict,
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()
    allowed = {"name", "description", "location_name", "estimated_cost_usd", "booking_url", "order_index"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    resp = db.table("itinerary_activities").update(updates).eq("id", activity_id).execute()
    return resp.data[0] if resp.data else {}
