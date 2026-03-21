from fastapi import APIRouter, Depends, HTTPException
from typing import List

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.trip import TripCreate, TripUpdate, TripResponse

router = APIRouter(prefix="/trips", tags=["trips"])


@router.get("", response_model=List[TripResponse])
async def list_trips(user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("trips").select("*").eq("user_id", user.user_id).neq("status", "cancelled").order("created_at", desc=True).execute()
    return resp.data or []


@router.post("", response_model=TripResponse)
async def create_trip(body: TripCreate, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    insert = {
        "user_id": user.user_id,
        "name": body.name,
        "itinerary_id": body.itinerary_id,
        "vlog_id": body.vlog_id,
        "start_date": str(body.start_date) if body.start_date else None,
        "end_date": str(body.end_date) if body.end_date else None,
        "traveller_count": body.traveller_count,
        "notes": body.notes,
        "status": "planning",
    }
    resp = db.table("trips").insert(insert).execute()
    return resp.data[0]


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(trip_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("trips").select("*").eq("id", trip_id).eq("user_id", user.user_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")
    return resp.data


@router.patch("/{trip_id}", response_model=TripResponse)
async def update_trip(trip_id: str, body: TripUpdate, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates = {k: str(v) if hasattr(v, 'isoformat') else v for k, v in updates.items()}
    resp = db.table("trips").update(updates).eq("id", trip_id).eq("user_id", user.user_id).execute()
    return resp.data[0] if resp.data else {}


@router.delete("/{trip_id}")
async def delete_trip(trip_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    db.table("trips").update({"status": "cancelled"}).eq("id", trip_id).eq("user_id", user.user_id).execute()
    return {"ok": True}
