from fastapi import APIRouter, Depends, HTTPException
from typing import List

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.schemas.booking import FlightSearchRequest, FlightBookRequest, BookingResponse
from app.services import duffel_service

router = APIRouter(prefix="/flights", tags=["flights"])


@router.post("/search")
async def search_flights(body: FlightSearchRequest, user: UserClaims = Depends(get_current_user)):
    try:
        offers = duffel_service.search_flights(
            origin=body.origin,
            destination=body.destination,
            departure_date=body.departure_date,
            passengers=body.passengers,
            cabin_class=body.cabin_class,
            return_date=body.return_date,
        )
        return offers
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Duffel error: {str(e)}")


@router.get("/offers/{offer_id}")
async def get_flight_offer(offer_id: str, user: UserClaims = Depends(get_current_user)):
    try:
        return duffel_service.get_flight_offer(offer_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/book", response_model=BookingResponse)
async def book_flight(body: FlightBookRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    # Verify trip belongs to user
    trip_resp = db.table("trips").select("id").eq("id", body.trip_id).eq("user_id", user.user_id).execute()
    if not trip_resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")

    try:
        passengers = [p.model_dump() for p in body.passengers]
        order = duffel_service.create_flight_order(body.offer_id, passengers, body.trip_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Booking failed: {str(e)}")

    # Persist booking
    booking_resp = db.table("bookings").insert({
        "trip_id": body.trip_id,
        "user_id": user.user_id,
        "booking_type": "flight",
        "duffel_order_id": order.get("id"),
        "duffel_booking_reference": order.get("booking_reference"),
        "status": "confirmed",
        "total_amount": float(order.get("total_amount", 0)),
        "currency": order.get("total_currency", "USD"),
        "passenger_details": passengers,
        "duffel_response": order,
        "booked_at": "now()",
    }).execute()

    # Update trip status
    db.table("trips").update({"status": "booked"}).eq("id", body.trip_id).execute()

    return booking_resp.data[0]
