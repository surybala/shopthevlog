from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])


class WebhookPayload(BaseModel):
    type: str
    record: Optional[dict] = None


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None


class OnboardingRequest(BaseModel):
    travel_styles: list[str] = []
    destinations: list[str] = []
    trip_durations: list[str] = []
    budget_range: Optional[str] = None


@router.post("/webhook")
async def auth_webhook(payload: WebhookPayload):
    """Called by Supabase auth webhook when a new user is created."""
    if payload.type == "INSERT" and payload.record:
        db = get_supabase()
        user_id = payload.record.get("id")
        email = payload.record.get("email", "")
        raw_meta = payload.record.get("raw_user_meta_data", {}) or {}
        display_name = raw_meta.get("display_name") or raw_meta.get("full_name") or email.split("@")[0]

        # Upsert profile (may already exist from OAuth)
        db.table("profiles").upsert({
            "id": user_id,
            "display_name": display_name,
            "avatar_url": raw_meta.get("avatar_url"),
        }, on_conflict="id").execute()

    return {"ok": True}


@router.get("/me")
async def get_me(user: UserClaims = Depends(get_current_user)):
    import traceback
    try:
        db = get_supabase()
        profile_resp = db.table("profiles").select("*").eq("id", user.user_id).execute()
        rows = profile_resp.data or []
        if not rows:
            # Profile not created yet — auto-create it
            display_name = user.email.split("@")[0] if user.email else "traveller"
            new_profile = {"id": user.user_id, "display_name": display_name, "onboarded": False}
            db.table("profiles").upsert(new_profile, on_conflict="id").execute()
            return {**new_profile, "avatar_url": None, "bio": None}
        return rows[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.patch("/profile")
async def update_profile(body: ProfileUpdate, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    resp = db.table("profiles").update(updates).eq("id", user.user_id).execute()
    return resp.data[0] if resp.data else {}


@router.post("/onboarding")
async def complete_onboarding(body: OnboardingRequest, user: UserClaims = Depends(get_current_user)):
    db = get_supabase()

    # Upsert taste preferences
    db.table("taste_preferences").upsert({
        "user_id": user.user_id,
        "travel_styles": body.travel_styles,
        "destinations": body.destinations,
        "trip_durations": body.trip_durations,
        "budget_range": body.budget_range,
    }, on_conflict="user_id").execute()

    # Mark profile as onboarded
    db.table("profiles").update({"onboarded": True}).eq("id", user.user_id).execute()

    return {"ok": True}
