import asyncio
import logging
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import Optional

from app.core.security import get_current_user, UserClaims

logger = logging.getLogger(__name__)
from app.db.client import get_supabase
from app.services.feed_ranking_service import get_paginated_feed, build_feed_for_user, _mark_shown
from app.schemas.vlog import FeedPage, VlogInteractionRequest

router = APIRouter(prefix="/feed", tags=["feed"])


@router.get("", response_model=FeedPage)
async def get_feed(
    background_tasks: BackgroundTasks,
    cursor: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    destination: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
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
