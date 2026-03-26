"""
experiences.py — Experiences / attractions search and detail endpoints.

Powered by Booking.com Attractions API (beta / v3.2-beta).
Detail responses merge static attraction data with reviews from a separate
Booking.com endpoint in a single asyncio.gather call.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.rate_limit import SEARCH_LIMIT, limiter
from app.core.security import UserClaims, get_current_user
from app.schemas.booking import ExperienceSearchRequest
from app.services import booking_com_service

router = APIRouter(prefix="/experiences", tags=["experiences"])
logger = logging.getLogger(__name__)


@router.post("/search")
@limiter.limit(SEARCH_LIMIT)
async def search_experiences(
    request: Request,
    body: ExperienceSearchRequest,
    user: UserClaims = Depends(get_current_user),
):
    """Search experiences and attractions via Booking.com.

    Results are sorted by review score descending (highest-rated first).
    Returns an empty list when Booking.com is unavailable or returns no results.
    """
    results = await booking_com_service.search_attractions(
        location=body.location,
        lat=body.lat,
        lng=body.lng,
    )

    # Sort by review score descending; fall back to 0 for items with no score.
    results.sort(
        key=lambda r: float(r.get("review_score") or 0),
        reverse=True,
    )
    return results


@router.get("/detail/{attraction_id}")
async def get_experience_detail(
    attraction_id: str,
    review_rows: int = Query(default=10, ge=1, le=50, description="Number of reviews to include"),
    user: UserClaims = Depends(get_current_user),
):
    """Fetch full experience/attraction details including reviews.

    Fetches attraction details and reviews concurrently and merges them into
    a single ExperienceDetail response.
    """
    # Fetch details and reviews in parallel.
    detail, reviews = await asyncio.gather(
        booking_com_service.get_attraction_details(attraction_id),
        booking_com_service.get_attraction_reviews(attraction_id, rows=review_rows),
        return_exceptions=True,
    )

    if isinstance(detail, Exception) or detail is None:
        logger.warning(
            "Could not fetch attraction detail for %s: %s", attraction_id, detail
        )
        raise HTTPException(
            status_code=404,
            detail=f"Experience '{attraction_id}' not found or unavailable.",
        )

    if isinstance(reviews, Exception):
        logger.warning(
            "Could not fetch attraction reviews for %s: %s", attraction_id, reviews
        )
        reviews = []

    # Merge reviews into the detail dict.
    detail["reviews"] = reviews
    return detail
