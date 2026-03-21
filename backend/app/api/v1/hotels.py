from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import HotelSearchRequest, HotelBookRequest, BookingResponse
from app.services import duffel_service

router = APIRouter(prefix="/hotels", tags=["hotels"])


@router.post("/search")
async def search_hotels(body: HotelSearchRequest, user: UserClaims = Depends(get_current_user)):
    try:
        return duffel_service.search_hotels(
            location=body.location,
            check_in=body.check_in,
            check_out=body.check_out,
            guests=body.guests,
            rooms=body.rooms,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Duffel error: {str(e)}")


@router.get("/offers/{rate_id}")
async def get_hotel_rate(rate_id: str, user: UserClaims = Depends(get_current_user)):
    try:
        return duffel_service.get_hotel_rate(rate_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/book", response_model=BookingResponse)
async def book_hotel(body: HotelBookRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    trip_resp = db.table("trips").select("id").eq("id", body.trip_id).eq("user_id", user.user_id).execute()
    if not trip_resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")

    try:
        order = duffel_service.create_hotel_order(body.rate_id, body.guests, body.trip_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Booking failed: {str(e)}")

    booking_resp = db.table("bookings").insert({
        "trip_id": body.trip_id,
        "user_id": user.user_id,
        "booking_type": "hotel",
        "duffel_order_id": order.get("id"),
        "duffel_booking_reference": order.get("reference"),
        "status": "confirmed",
        "total_amount": float(order.get("total_amount", 0)),
        "currency": order.get("currency", "USD"),
        "duffel_response": order,
        "booked_at": "now()",
    }).execute()

    db.table("trips").update({"status": "booked"}).eq("id", body.trip_id).execute()
    return booking_resp.data[0]
