import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import BookingResponse
from app.services import booking_com_service, duffel_service, liteapi_service

logger = logging.getLogger(__name__)

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
async def cancel_booking(booking_id: str, user: UserClaims = Depends(get_current_user)):  # noqa: RUF029
    db = get_supabase()
    resp = db.table("bookings").select("*").eq("id", booking_id).eq("user_id", user.user_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Booking not found")

    booking = resp.data
    booking_type = booking.get("booking_type")
    provider = booking.get("provider", "")
    order_id = booking.get("duffel_order_id")  # stores provider's booking/order ID

    # ── Downstream cancellation ────────────────────────────────────────────────
    # Route to the correct provider cancel function.
    # If the downstream call fails we surface the error rather than silently
    # marking the booking as cancelled — the user needs to know if their
    # reservation is still active with the provider.
    if order_id:
        try:
            if booking_type == "flight":
                # Duffel Air: create + confirm cancellation
                duffel_service.cancel_flight_order(order_id)
            elif booking_type == "hotel" and provider == "liteapi":
                # LiteAPI: DELETE /bookings/{bookingId}
                liteapi_service.cancel_hotel_booking(order_id)
            elif booking_type == "hotel" and provider == "duffel":
                # Duffel Stays: DELETE /stays/bookings/{id}
                duffel_service.cancel_hotel_order(order_id)
            elif provider == "booking_com":
                # Booking.com Demand API: the order_id is stored in metadata.
                bcom_order_id = (
                    (booking.get("metadata") or {}).get("booking_com_order_id")
                    or order_id
                )
                cancelled = await booking_com_service.cancel_order(bcom_order_id)
                if not cancelled:
                    raise ValueError(
                        f"Booking.com could not cancel order {bcom_order_id}. "
                        "The reservation may be non-refundable or already cancelled."
                    )
            else:
                logger.warning(
                    f"cancel_booking: no downstream handler for "
                    f"booking_type={booking_type!r} provider={provider!r} — DB-only cancel"
                )
        except ValueError as e:
            # Provider explicitly refused (non-refundable fare, policy, etc.)
            raise HTTPException(
                status_code=422,
                detail=str(e),
            )
        except Exception as e:
            # Network / unexpected error — don't silently swallow
            logger.error(f"Downstream cancellation failed for booking {booking_id}: {e}", exc_info=True)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Could not reach the booking provider to cancel your reservation. "
                    "Please try again, or contact support if the problem persists."
                ),
            )

    db.table("bookings").update({"status": "cancelled"}).eq("id", booking_id).execute()
    return {"ok": True}
