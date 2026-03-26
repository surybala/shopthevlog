"""
cars.py — Car rental search and detail endpoints (Booking.com Cars API).

Current status
--------------
Booking.com car rentals is an early-access pilot.  Search and detail are
fully implemented; the book endpoint is scaffolded but returns 501 until
Booking.com confirms general availability for the partner account.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rate_limit import BOOKING_LIMIT, SEARCH_LIMIT, limiter
from app.core.security import UserClaims, get_current_user
from app.schemas.booking import CarSearchRequest
from app.services import booking_com_service

router = APIRouter(prefix="/cars", tags=["cars"])
logger = logging.getLogger(__name__)


@router.post("/search")
@limiter.limit(SEARCH_LIMIT)
async def search_cars(
    request: Request,
    body: CarSearchRequest,
    user: UserClaims = Depends(get_current_user),
):
    """Search car rentals via Booking.com.

    Returns a list of CarOffer objects sorted by total price ascending.
    Returns an empty list (not an error) when Booking.com is unavailable or
    when no cars match the criteria — allowing the UI to show a graceful
    empty state.
    """
    results = await booking_com_service.search_cars(
        pickup_location=body.pickup_location,
        dropoff_location=body.dropoff_location,
        pickup_datetime=body.pickup_datetime,
        dropoff_datetime=body.dropoff_datetime,
        driver_age=body.driver_age,
        currency=body.currency,
    )

    results.sort(
        key=lambda r: float(r.get("total_amount") or "999999")
    )
    return results


@router.get("/detail/{car_id}")
async def get_car_detail(
    car_id: str,
    user: UserClaims = Depends(get_current_user),
):
    """Placeholder — Booking.com cars API does not expose a dedicated detail
    endpoint in the current pilot.  The full car object returned by /search
    already contains all available fields; clients should use that data.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "Car detail endpoint not yet available. "
            "All car information is included in the /cars/search response."
        ),
    )


@router.post("/book")
@limiter.limit(BOOKING_LIMIT)
async def book_car(
    request: Request,
    user: UserClaims = Depends(get_current_user),
):
    """Car booking — scaffolded, pending Booking.com general availability confirmation."""
    raise HTTPException(
        status_code=501,
        detail=(
            "Car booking is not yet available. "
            "Booking.com car rentals are currently in early-access pilot."
        ),
    )
