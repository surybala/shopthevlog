from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import BookingResponse
from app.services import duffel_service

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("", response_model=List[BookingResponse])
async def list_bookings(
    trip_id: Optional[str] = Query(None),
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()
    query = db.table("bookings").select("*").eq("user_id", user.user_id)
    if trip_id:
        query = query.eq("trip_id", trip_id)
    resp = query.order("created_at", desc=True).execute()
    return resp.data or []


@router.get("/{booking_id}", response_model=BookingResponse)
async def get_booking(booking_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("bookings").select("*").eq("id", booking_id).eq("user_id", user.user_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    return resp.data


@router.delete("/{booking_id}")
async def cancel_booking(booking_id: str, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    resp = db.table("bookings").select("*").eq("id", booking_id).eq("user_id", user.user_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Booking not found")

    booking = resp.data
    if booking.get("duffel_order_id") and booking["booking_type"] == "flight":
        try:
            duffel_service.cancel_flight_order(booking["duffel_order_id"])
        except Exception:
            pass  # Continue to mark as cancelled even if Duffel cancel fails

    db.table("bookings").update({"status": "cancelled"}).eq("id", booking_id).execute()
    return {"ok": True}
