import asyncio
import logging
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from app.core.security import get_current_user, UserClaims

logger = logging.getLogger(__name__)
from app.db.client import get_supabase
from app.services.feed_ranking_service import get_paginated_feed, build_feed_for_user, _mark_shown, _VLOG_COLS
from app.schemas.vlog import FeedPage, VlogInteractionRequest

router = APIRouter(prefix="/feed", tags=["feed"])


@router.get("", response_model=FeedPage)
async def get_feed(
    background_tasks: BackgroundTasks,
    cursor: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    destination: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
    duration: Optional[str] = Query(None, description="short | medium | long"),
    user: UserClaims = Depends(get_current_user),
):
    # Run the synchronous DB work in a thread so we don't block the event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: get_paginated_feed(
            user_id=user.user_id,
            cursor=cursor,
            limit=limit,
            destination=destination,
            style=style,
            duration=duration,
        ),
    )

    # Cache miss on first page — rebuild in background, return empty immediately.
    if not result["vlogs"] and not cursor:
        logger.info("Feed cache empty for %s, queuing background rebuild", user.user_id)
        background_tasks.add_task(build_feed_for_user, user.user_id)

    # Mark vlogs as shown after the response is sent — zero added latency
    shown_ids = result.pop("_shown_ids", [])
    if shown_ids:
        db = get_supabase()
        background_tasks.add_task(_mark_shown, db, user.user_id, shown_ids)

    return result


@router.post("/refresh")
async def refresh_feed(background_tasks: BackgroundTasks, user: UserClaims = Depends(get_current_user)):
    background_tasks.add_task(build_feed_for_user, user.user_id)
    return {"ok": True, "message": "Feed refresh queued"}


@router.post("/seed")
async def seed_feed(background_tasks: BackgroundTasks, user: UserClaims = Depends(get_current_user)):
    """
    Seed the discovery pool with popular public travel vlogs, then rebuild
    this user's feed.  Useful for first-time setup or when the feed is empty.
    """
    from app.api.v1.social import _seed_public_travel_vlogs

    db = get_supabase()

    async def _run():
        await _seed_public_travel_vlogs(db)
        build_feed_for_user(user.user_id)

    background_tasks.add_task(_run)
    return {"ok": True, "message": "Seeding travel vlogs and rebuilding your feed in the background"}


@router.post("/interact")
async def record_interaction(body: VlogInteractionRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    db.table("vlog_interactions").upsert({
        "user_id": user.user_id,
        "vlog_id": body.vlog_id,
        "action": body.action,
        "duration_watched_seconds": body.duration_watched_seconds,
    }, on_conflict="user_id,vlog_id,action").execute()
    return {"ok": True}


class FeedSearchRequest(BaseModel):
    destination: str
    limit: int = 20


def _flatten_itineraries(v: dict) -> dict:
    """Inline-flatten the nested itineraries join into a scalar itinerary_id."""
    itineraries = v.pop("itineraries", None)
    if isinstance(itineraries, dict):
        v["itinerary_id"] = itineraries.get("id")
    elif isinstance(itineraries, list) and itineraries:
        v["itinerary_id"] = itineraries[0]["id"]
    else:
        v["itinerary_id"] = None
    return v


@router.post("/search", response_model=FeedPage)
async def search_feed_by_destination(
    body: FeedSearchRequest,
    user: UserClaims = Depends(get_current_user),
):
    """
    Live-search YouTube for vlogs matching a destination (any city or country
    worldwide). New results are inserted into the DB so subsequent GET /feed
    calls will include them too. Deduplicates against existing rows.

    Steps:
      1. Title-search the existing vlogs table for fast local results.
      2. Call YouTube Data API for the destination query.
      3. Insert new vlogs with the destination tag pre-set.
      4. Return the combined, deduplicated list.
    """
    from app.services.youtube_service import search_travel_vlogs

    db = get_supabase()
    destination = body.destination.strip()
    if not destination:
        return {"vlogs": [], "next_cursor": None, "total": 0}

    loop = asyncio.get_event_loop()

    # ── Step 1: existing DB rows matching by title ─────────────────────────
    existing_resp = (
        db.table("vlogs")
        .select(_VLOG_COLS)
        .eq("processing_status", "ready")
        .ilike("title", f"%{destination}%")
        .limit(body.limit)
        .execute()
    )
    existing_vlogs = existing_resp.data or []
    seen_ids: set[str] = {v["id"] for v in existing_vlogs}

    # ── Step 2: Live YouTube search ────────────────────────────────────────
    try:
        yt_results = await loop.run_in_executor(
            None,
            lambda: search_travel_vlogs(f"{destination} travel vlog", max_results=20),
        )
    except Exception as exc:
        logger.warning("YouTube search failed for '%s': %s", destination, exc)
        yt_results = []

    # ── Step 3: Insert new vlogs, collect IDs ─────────────────────────────
    new_ids: list[str] = []
    for v in yt_results:
        exists = (
            db.table("vlogs")
            .select("id")
            .eq("platform_video_id", v.platform_video_id)
            .execute()
        )
        if exists.data:
            vid = exists.data[0]["id"]
            if vid not in seen_ids:
                seen_ids.add(vid)
                new_ids.append(vid)
            continue

        insert_resp = db.table("vlogs").insert({
            "platform": "youtube",
            "platform_video_id": v.platform_video_id,
            "title": v.title,
            "description": v.description,
            "thumbnail_url": v.thumbnail_url,
            "video_url": v.video_url,
            "channel_name": v.channel_name,
            "channel_id": v.channel_id,
            "duration_seconds": v.duration_seconds,
            "published_at": v.published_at.isoformat() if v.published_at else None,
            "view_count": v.view_count,
            "like_count": v.like_count,
            "processing_status": "ready",
            "raw_transcript": v.description or v.title,
            "destinations": [destination],
            "travel_styles": [],
        }).execute()
        if insert_resp.data:
            vid = insert_resp.data[0]["id"]
            seen_ids.add(vid)
            new_ids.append(vid)

    # ── Step 4: Fetch full data for newly found/inserted vlogs ────────────
    if new_ids:
        new_resp = db.table("vlogs").select(_VLOG_COLS).in_("id", new_ids).execute()
        extra_vlogs = new_resp.data or []
    else:
        extra_vlogs = []

    combined = existing_vlogs + extra_vlogs

    # Deduplicate (existing_vlogs may overlap with new_ids if already in DB)
    deduped: list[dict] = []
    final_seen: set[str] = set()
    for v in combined:
        if v["id"] not in final_seen:
            final_seen.add(v["id"])
            deduped.append(_flatten_itineraries(v))

    page = deduped[: body.limit]
    return {"vlogs": page, "next_cursor": None, "total": len(page)}
