"""
Taste preferences CRUD for the authenticated user.

GET  /preferences      → return current taste_preferences row (or defaults)
PATCH /preferences     → upsert fields; triggers background seed + feed rebuild
                         when travel_styles or destinations change.
"""
import logging
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/preferences", tags=["preferences"])


class PreferencesUpdate(BaseModel):
    travel_styles: Optional[List[str]] = None
    destinations: Optional[List[str]] = None
    trip_durations: Optional[List[str]] = None
    budget_range: Optional[str] = None
    home_location: Optional[str] = None


@router.get("")
async def get_preferences(user: UserClaims = Depends(get_current_user)):
    """Return the user's taste preferences, or empty defaults if not set yet."""
    db = get_supabase()
    resp = db.table("taste_preferences").select("*").eq("user_id", user.user_id).execute()
    if resp.data:
        return resp.data[0]
    return {
        "travel_styles": [],
        "destinations": [],
        "trip_durations": [],
        "budget_range": None,
        "home_location": None,
    }


@router.patch("")
async def update_preferences(
    body: PreferencesUpdate,
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    """
    Upsert taste preferences. When travel_styles or destinations change,
    seeds YouTube content matching those interests and rebuilds the feed.
    """
    db = get_supabase()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if update:
        db.table("taste_preferences").upsert(
            {"user_id": user.user_id, **update},
            on_conflict="user_id",
        ).execute()

    # Seed + rebuild whenever interests or desired destinations change
    if body.travel_styles is not None or body.destinations is not None:
        from app.api.v1.social import _seed_for_user_interests
        background_tasks.add_task(
            _seed_for_user_interests,
            user.user_id,
            body.travel_styles or [],
            body.destinations or [],
        )

    return {"ok": True}
