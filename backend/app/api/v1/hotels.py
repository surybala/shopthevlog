import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder

from app.core.config import settings
from app.core.exceptions import StaleOfferError
from app.core.rate_limit import BOOKING_LIMIT, SEARCH_LIMIT, limiter
from app.core.security import UserClaims, get_current_user
from app.db.client import get_supabase
from app.schemas.booking import (
    BookingResponse,
    HotelBookRequest,
    HotelPrebookRequest,
    HotelPrebookResponse,
    HotelSearchRequest,
)
from app.services import booking_com_service, duffel_service, hotel_content_service, liteapi_service

router = APIRouter(prefix="/hotels", tags=["hotels"])
logger = logging.getLogger(__name__)


# ─── Search ───────────────────────────────────────────────────────────────────


@router.post("/search")
@limiter.limit(SEARCH_LIMIT)
async def search_hotels(
    request: Request,
    body: HotelSearchRequest,
    user: UserClaims = Depends(get_current_user),
):
    """Search hotels across LiteAPI and Booking.com in parallel, merged by price."""

    # Run LiteAPI (sync wrapped) and Booking.com (async) in parallel.
    async def _liteapi_search():
        if not settings.LITEAPI_API_KEY:
            return []
        try:
            return liteapi_service.search_hotels(
                location=body.location,
                check_in=body.check_in,
                check_out=body.check_out,
                guests=body.guests,
                rooms=body.rooms,
            )
        except Exception as exc:
            logger.warning("LiteAPI hotel search failed: %s", exc)
            return []

    async def _duffel_fallback(liteapi_results):
        """Use Duffel only when LiteAPI returns nothing."""
        if liteapi_results:
            return []
        try:
            return duffel_service.search_hotels(
                location=body.location,
                check_in=body.check_in,
                check_out=body.check_out,
                guests=body.guests,
            )
        except Exception as exc:
            logger.warning("Duffel hotel search failed: %s", exc)
            return []

    # Step 1: run LiteAPI + Booking.com concurrently.
    liteapi_results, bookingcom_results = await asyncio.gather(
        _liteapi_search(),
        booking_com_service.search_hotels(
            location=body.location,
            check_in=body.check_in,
            check_out=body.check_out,
            adults=body.guests,
            rooms=body.rooms,
        ),
        return_exceptions=True,
    )

    # Unwrap exceptions → empty list so we always have a list.
    if isinstance(liteapi_results, Exception):
        logger.warning("LiteAPI parallel search raised: %s", liteapi_results)
        liteapi_results = []
    if isinstance(bookingcom_results, Exception):
        logger.warning("Booking.com parallel search raised: %s", bookingcom_results)
        bookingcom_results = []

    # Step 2: Duffel fallback only when both primary providers return nothing.
    if not liteapi_results and not bookingcom_results:
        try:
            bookingcom_results = duffel_service.search_hotels(
                location=body.location,
                check_in=body.check_in,
                check_out=body.check_out,
                guests=body.guests,
            )
        except Exception as exc:
            logger.warning("Duffel hotel fallback failed: %s", exc)

    combined = list(liteapi_results) + list(bookingcom_results)
    combined.sort(
        key=lambda r: float(r.get("cheapest_rate_total_amount") or "999999")
    )
    return combined[:40]


# ─── Detail ───────────────────────────────────────────────────────────────────


@router.get("/detail")
async def hotel_detail(
    hotel_id: str = Query(..., description="Provider hotel ID"),
    provider: str = Query("liteapi"),
    hotel_name: str | None = Query(None, description="Hotel display name for content enrichment"),
    lat: float | None = Query(None, description="Hotel latitude for content enrichment"),
    lng: float | None = Query(None, description="Hotel longitude for content enrichment"),
    user: UserClaims = Depends(get_current_user),
):
    """Fetch rich hotel details: description, amenities, photos, reviews, policies.

    Supports providers: liteapi, duffel, booking_com.
    When hotel_name (+ optionally lat/lng) is provided, photos and reviews are
    enriched from Google Places / Foursquare.
    """
    detail: dict | None = None

    # ── Provider routing ──────────────────────────────────────────────────────
    if provider == "booking_com":
        detail = await booking_com_service.get_hotel_details(hotel_id)
        if detail is None:
            raise HTTPException(
                status_code=502, detail="Could not fetch hotel details from Booking.com"
            )

    elif provider == "liteapi":
        if not settings.LITEAPI_API_KEY:
            raise HTTPException(status_code=503, detail="LiteAPI not configured")
        try:
            detail = liteapi_service.get_hotel_details(hotel_id)
        except Exception as exc:
            logger.warning("Hotel detail fetch failed for %s: %s", hotel_id, exc)
            raise HTTPException(
                status_code=502, detail=f"Could not fetch hotel details: {exc}"
            )

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Detail fetch not supported for provider '{provider}'",
        )

    # ── Content enrichment (best-effort, applies to all providers) ─────────────
    if hotel_name:
        try:
            enriched = hotel_content_service.enrich_hotel(hotel_id, hotel_name, lat, lng)

            existing_urls: set[str] = {p.get("url", "") for p in detail.get("photos", [])}
            extra_photos = [p for p in enriched["photos"] if p.get("url") not in existing_urls]
            detail["photos"] = extra_photos + detail.get("photos", [])

            existing_texts: set[str] = {r.get("text", "") for r in detail.get("reviews", [])}
            extra_reviews = [r for r in enriched["reviews"] if r.get("text", "") not in existing_texts]
            detail["reviews"] = extra_reviews + detail.get("reviews", [])

            if enriched.get("rating") and not detail.get("review_score"):
                detail["review_score"] = enriched["rating"]
            if enriched.get("rating_count") and not detail.get("review_count"):
                detail["review_count"] = enriched["rating_count"]

        except Exception as exc:
            logger.warning("Hotel content enrichment failed for '%s': %s", hotel_name, exc)

    return detail


# ─── Prebook ──────────────────────────────────────────────────────────────────


@router.post("/prebook", response_model=HotelPrebookResponse)
@limiter.limit(BOOKING_LIMIT)
async def prebook_hotel(
    request: Request,
    body: HotelPrebookRequest,
    user: UserClaims = Depends(get_current_user),
):
    """Lock in a rate before the user fills in passenger details.

    Supports LiteAPI and Booking.com offers.
    """
    if body.rate_id.startswith("booking_com_"):
        # Booking.com: extract accommodation + product IDs from the composite rate_id.
        # Expected format: "booking_com_{acc_id}_{product_id}"
        parts = body.rate_id.split("_", 3)
        if len(parts) < 4:
            raise HTTPException(status_code=400, detail="Invalid Booking.com rate_id format")
        acc_id, product_id = parts[2], parts[3]
        guests = [{"first_name": "Guest", "last_name": "Guest"}]  # placeholder pre-passenger-form
        preview = await booking_com_service.preview_order(acc_id, product_id, guests)
        if not preview:
            raise HTTPException(status_code=502, detail="Booking.com preview order failed")
        return {"prebook_id": preview.get("token", body.rate_id)}

    elif body.rate_id.startswith("liteapi_hotel_"):
        try:
            prebook_id = liteapi_service.prebook_hotel(body.rate_id)
        except StaleOfferError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except Exception as exc:
            logger.error("Hotel prebook failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=502, detail=f"Prebook failed: {exc}")
        return {"prebook_id": prebook_id}

    else:
        raise HTTPException(
            status_code=400,
            detail="Prebook is only supported for LiteAPI and Booking.com offers",
        )


# ─── Book ─────────────────────────────────────────────────────────────────────


@router.post("/book", response_model=BookingResponse)
@limiter.limit(BOOKING_LIMIT)
async def book_hotel(
    request: Request,
    body: HotelBookRequest,
    user: UserClaims = Depends(get_current_user),
):
    db = get_supabase()

    trip_resp = (
        db.table("trips").select("id").eq("id", body.trip_id).eq("user_id", user.user_id).execute()
    )
    if not trip_resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")

    order: dict = {}
    try:
        if body.rate_id.startswith("booking_com_"):
            # Booking.com: prebook_id holds the preview token from /prebook.
            if not body.prebook_id:
                raise HTTPException(status_code=400, detail="prebook_id (preview token) required for Booking.com")
            bcom_order = await booking_com_service.create_order(
                preview_token=body.prebook_id,
                guests=[
                    {
                        "first_name": g.given_name,
                        "last_name": g.family_name,
                        "email": getattr(g, "email", ""),
                        "phone": getattr(g, "phone_number", ""),
                    }
                    for g in (body.guests or [])
                ],
                booker={"country": "US", "platform": "desktop"},
            )
            if not bcom_order:
                raise HTTPException(status_code=502, detail="Booking.com order creation failed")
            order = {
                "id": bcom_order.get("order_id"),
                "reference": bcom_order.get("order_id"),
                "total_amount": str(bcom_order.get("total_amount", "0")),
                "currency": bcom_order.get("currency", "USD"),
                "provider": "booking_com",
                "raw": bcom_order,
                "metadata": {"booking_com_order_id": bcom_order.get("order_id")},
            }

        elif body.rate_id.startswith("liteapi_hotel_"):
            order = liteapi_service.create_hotel_order(
                body.rate_id, body.guests, prebook_id=body.prebook_id
            )

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

    except (StaleOfferError, HTTPException):
        raise
    except Exception as exc:
        logger.error("Hotel booking failed: %s: %s", type(exc).__name__, exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"Booking failed: {exc}")

    search_params = {
        "hotel_name": body.hotel_name,
        "check_in": body.check_in,
        "check_out": body.check_out,
        "hotel_address": body.hotel_address,
        "hotel_rating": body.hotel_rating,
    }

    try:
        booking_payload = jsonable_encoder(
            {
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
                "metadata": order.get("metadata"),
                "search_params": search_params,
                "booked_at": datetime.now(timezone.utc).isoformat(),
            }
        )
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save booking record: {exc}")
