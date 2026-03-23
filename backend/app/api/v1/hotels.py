from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from datetime import datetime, timezone
import asyncio
import concurrent.futures
import logging

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import HotelSearchRequest, HotelBookRequest, BookingResponse
from app.services import liteapi_service, amadeus_service, duffel_service
from app.core.config import settings

router = APIRouter(prefix="/hotels", tags=["hotels"])
logger = logging.getLogger(__name__)


def _search_all_providers(body: HotelSearchRequest) -> list[dict]:
    """Run LiteAPI + Amadeus in parallel, merge sorted by price."""

    def run_liteapi():
        if not settings.LITEAPI_API_KEY:
            return []
        try:
            return liteapi_service.search_hotels(
                location=body.location, check_in=body.check_in,
                check_out=body.check_out, guests=body.guests, rooms=body.rooms,
            )
        except Exception as e:
            logger.warning(f"LiteAPI search failed: {e}")
            return []

    def run_amadeus():
        if not settings.AMADEUS_CLIENT_ID or not settings.AMADEUS_CLIENT_SECRET:
            return []
        try:
            return amadeus_service.search_hotels(
                location=body.location, check_in=body.check_in,
                check_out=body.check_out, guests=body.guests, rooms=body.rooms,
            )
        except Exception as e:
            logger.warning(f"Amadeus search failed: {e}")
            return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(run_liteapi)
        f2 = pool.submit(run_amadeus)
        results = f1.result() + f2.result()

    results.sort(key=lambda r: float(r.get("cheapest_rate_total_amount") or "999999"))
    return results[:20]


@router.post("/search")
async def search_hotels(body: HotelSearchRequest, user: UserClaims = Depends(get_current_user)):
    loop = asyncio.get_event_loop()
    try:
        results = await loop.run_in_executor(None, lambda: _search_all_providers(body))
        if not results:
            raise HTTPException(status_code=404, detail="No hotels found for this destination and dates.")
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Hotel search error: {str(e)}")


@router.post("/book", response_model=BookingResponse)
async def book_hotel(body: HotelBookRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    trip_resp = db.table("trips").select("id").eq("id", body.trip_id).eq("user_id", user.user_id).execute()
    if not trip_resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")

    # Route booking to the correct provider based on offer ID prefix
    try:
        if body.rate_id.startswith("liteapi_hotel_"):
            order = liteapi_service.create_hotel_order(body.rate_id, body.guests)
        elif body.rate_id.startswith("amadeus_hotel_"):
            order = amadeus_service.create_hotel_order(body.rate_id, body.guests)
        else:
            # Legacy Duffel Stays
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
