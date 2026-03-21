from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase
from app.services.feed_ranking_service import get_paginated_feed, build_feed_for_user
from app.schemas.vlog import FeedPage, VlogInteractionRequest

router = APIRouter(prefix="/feed", tags=["feed"])


@router.get("", response_model=FeedPage)
async def get_feed(
    cursor: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    destination: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
    user: UserClaims = Depends(get_current_user),
):
    return get_paginated_feed(
        user_id=user.user_id,
        cursor=cursor,
        limit=limit,
        destination=destination,
        style=style,
    )


@router.post("/refresh")
async def refresh_feed(background_tasks: BackgroundTasks, user: UserClaims = Depends(get_current_user)):
    background_tasks.add_task(build_feed_for_user, user.user_id)
    return {"ok": True, "message": "Feed refresh queued"}


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
