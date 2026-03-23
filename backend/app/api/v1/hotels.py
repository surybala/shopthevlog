from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from datetime import datetime, timezone
import logging

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import HotelSearchRequest, HotelBookRequest, BookingResponse
from app.services import liteapi_service, duffel_service

router = APIRouter(prefix="/hotels", tags=["hotels"])
logger = logging.getLogger(__name__)


@router.post("/search")
async def search_hotels(body: HotelSearchRequest, user: UserClaims = Depends(get_current_user)):
    results = []

    if settings.LITEAPI_API_KEY:
        try:
            results = liteapi_service.search_hotels(
                location=body.location, check_in=body.check_in,
                check_out=body.check_out, guests=body.guests, rooms=body.rooms,
            )
        except Exception as e:
            logger.warning(f"LiteAPI search failed: {e}")

    if not results:
        # Fallback to Duffel Stays
        try:
            results = duffel_service.search_hotels(
                location=body.location, check_in=body.check_in,
                check_out=body.check_out, guests=body.guests,
            )
        except Exception as e:
            logger.warning(f"Duffel hotel search failed: {e}")

    results.sort(key=lambda r: float(r.get("cheapest_rate_total_amount") or "999999"))
    return results[:20]


@router.post("/book", response_model=BookingResponse)
async def book_hotel(body: HotelBookRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    trip_resp = db.table("trips").select("id").eq("id", body.trip_id).eq("user_id", user.user_id).execute()
    if not trip_resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")

    try:
        if body.rate_id.startswith("liteapi_hotel_"):
            order = liteapi_service.create_hotel_order(body.rate_id, body.guests)
        else:
            # Duffel Stays
            raw = duffel_service.create_hotel_order(body.rate_id, body.guests, body.trip_id)
            order = {
                "id": raw.get("id"),
                "reference": raw.get("id"),
                "total_amount": str(raw.get("total_amount", "0")),
                "currency": raw.get("currency", "USD"),
                "provider": "duffel",
                "raw": raw,
            }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Booking failed: {str(e)}")

    try:
        booking_payload = jsonable_encoder({
            "trip_id": body.trip_id,
            "user_id": user.user_id,
            "booking_type": "hotel",
            "provider": order.get("provider", "unknown"),
            "duffel_order_id": order.get("id"),
            "duffel_booking_reference": order.get("reference"),
            "status": "confirmed",
            "total_amount": float(order.get("total_amount") or 0),
            "currency": order.get("currency", "USD"),
            "duffel_response": order.get("raw") or order,
            "booked_at": datetime.now(timezone.utc).isoformat(),
        })
        booking_resp = db.table("bookings").insert(booking_payload).execute()

        if not booking_resp.data:
            raise HTTPException(
                status_code=500,
                detail="Booking placed but failed to save. Check provider dashboard.",
            )

        db.table("trips").update({"status": "booked"}).eq("id", body.trip_id).execute()
        return booking_resp.data[0]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save booking record: {str(e)}")
