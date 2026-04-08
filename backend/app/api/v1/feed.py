import asyncio
import logging
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from app.core.security import get_current_user, UserClaims

logger = logging.getLogger(__name__)
from app.db.client import get_supabase
from app.services.feed_ranking_service import (
    get_paginated_feed,
    build_feed_for_user,
    _mark_shown,
    _VLOG_COLS,
    _flatten_vlog_itineraries,
    get_trending_vlogs,
    get_new_this_week,
    get_vlogs_by_platform,
)
from app.schemas.vlog import FeedPage, VlogInteractionRequest

router = APIRouter(prefix="/feed", tags=["feed"])

# ── Interest → emoji mapping for section headers ───────────────────────────────
_STYLE_EMOJI: dict[str, str] = {
    "adventure": "🧗", "luxury": "✨", "budget travel": "💰", "budget": "💰",
    "solo travel": "🎒", "solo": "🎒", "family": "👨‍👩‍👧",
    "backpacking": "🏕️", "cultural": "🏛️", "beach & islands": "🏖️", "beach": "🏖️",
    "mountain": "🏔️", "city break": "🌆", "road trip": "🚗",
    "food & culinary": "🍜", "photography": "📸", "wildlife": "🦁",
    "history": "🏺", "wellness": "🧘",
}


@router.get("", response_model=FeedPage)
async def get_feed(
    background_tasks: BackgroundTasks,
    cursor: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    destination: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
    duration: Optional[str] = Query(None, description="short | medium | long"),
    platform: Optional[str] = Query(None, description="youtube | tiktok | instagram"),
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
            platform=platform,
        ),
    )

    # Cache miss on first page (unfiltered) — rebuild in background, return empty immediately.
    if not result["vlogs"] and not cursor and not (destination or style or duration or platform):
        logger.info("Feed cache empty for %s, queuing background rebuild", user.user_id)
        background_tasks.add_task(build_feed_for_user, user.user_id)

    # Mark vlogs as shown after the response is sent — zero added latency
    shown_ids = result.pop("_shown_ids", [])
    if shown_ids:
        db = get_supabase()
        background_tasks.add_task(_mark_shown, db, user.user_id, shown_ids)

    return result


@router.get("/trending", response_model=FeedPage)
async def get_trending(
    limit: int = Query(20, ge=1, le=50),
    platform: Optional[str] = Query(None, description="youtube | tiktok | instagram"),
    user: UserClaims = Depends(get_current_user),
):
    """
    Return the most-viewed ready vlogs across all users.
    Optionally filtered by platform.  Used for the Trending Now section.
    """
    loop = asyncio.get_event_loop()
    vlogs = await loop.run_in_executor(
        None, lambda: get_trending_vlogs(limit=limit, platform=platform)
    )
    return {"vlogs": vlogs, "next_cursor": None, "total": len(vlogs)}


@router.get("/sections")
async def get_feed_sections(
    user: UserClaims = Depends(get_current_user),
):
    """
    Return curated feed sections for the multi-section Discover page.

    Sections included (only sections with ≥ 1 vlog are returned):
      1. For You          — personalised ranked feed
      2. Trending Now     — highest view-count vlogs
      3. New This Week    — vlogs added to DB in the last 7 days
      4. <Interest>       — one section per user travel style (up to 4)
      5. TikTok Picks     — if TikTok content exists
      6. Instagram Reels  — if Instagram content exists
      7. Because You Watched — vlogs similar to recent interactions

    Each section: { id, title, emoji, vlogs[] }
    """
    db = get_supabase()
    loop = asyncio.get_event_loop()

    # Load user preferences for per-interest sections + because-you-watched
    prefs_resp = await loop.run_in_executor(
        None,
        lambda: db.table("taste_preferences")
        .select("travel_styles,destinations")
        .eq("user_id", user.user_id)
        .execute(),
    )
    prefs = prefs_resp.data[0] if prefs_resp.data else {}
    user_styles: list[str] = prefs.get("travel_styles") or []

    # Run heavy DB calls concurrently.
    # return_exceptions=True ensures a failure in one section (e.g. TikTok/Instagram
    # platform columns not yet populated) never crashes the whole endpoint.
    results = await asyncio.gather(
        loop.run_in_executor(None, lambda: get_paginated_feed(user.user_id, limit=12)),
        loop.run_in_executor(None, lambda: get_trending_vlogs(limit=12)),
        loop.run_in_executor(None, lambda: get_new_this_week(limit=12)),
        loop.run_in_executor(None, lambda: get_vlogs_by_platform("tiktok", limit=12)),
        loop.run_in_executor(None, lambda: get_vlogs_by_platform("instagram", limit=12)),
        return_exceptions=True,
    )
    for_you_result = results[0] if not isinstance(results[0], BaseException) else {"vlogs": []}
    trending      = results[1] if not isinstance(results[1], BaseException) else []
    new_week      = results[2] if not isinstance(results[2], BaseException) else []
    tiktok_vlogs  = results[3] if not isinstance(results[3], BaseException) else []
    ig_vlogs      = results[4] if not isinstance(results[4], BaseException) else []
    for i, name in enumerate(["for_you", "trending", "new_week", "tiktok", "instagram"]):
        if isinstance(results[i], BaseException):
            logger.warning("feed/sections: %s section failed: %s", name, results[i])

    sections: list[dict] = []

    # 1. For You
    for_you = for_you_result.get("vlogs", [])
    if for_you:
        sections.append({"id": "for_you", "title": "For You", "emoji": "✨", "vlogs": for_you})

    # 2. Trending Now
    if trending:
        sections.append({"id": "trending", "title": "Trending Now", "emoji": "🔥", "vlogs": trending})

    # 3. New This Week
    if new_week:
        sections.append({"id": "new_this_week", "title": "New This Week", "emoji": "🆕", "vlogs": new_week})

    # 4. Per-interest sections (up to 4 of user's travel styles)
    interest_tasks = [
        loop.run_in_executor(
            None,
            lambda s=style: get_paginated_feed(user.user_id, limit=12, style=s),
        )
        for style in user_styles[:4]
    ]
    interest_results = await asyncio.gather(*interest_tasks, return_exceptions=True)
    for style, result in zip(user_styles[:4], interest_results):
        if isinstance(result, BaseException):
            logger.warning("feed/sections: interest section '%s' failed: %s", style, result)
            continue
        vlogs = result.get("vlogs", [])
        if vlogs:
            emoji = _STYLE_EMOJI.get(style.lower(), "🎯")
            sections.append({
                "id": f"style_{style.lower().replace(' ', '_').replace('&', 'and')}",
                "title": style.title(),
                "emoji": emoji,
                "vlogs": vlogs,
            })

    # 5. TikTok Picks
    if tiktok_vlogs:
        sections.append({"id": "tiktok_picks", "title": "TikTok Picks", "emoji": "🎵", "vlogs": tiktok_vlogs})

    # 6. Instagram Reels
    if ig_vlogs:
        sections.append({"id": "instagram_reels", "title": "Instagram Reels", "emoji": "📸", "vlogs": ig_vlogs})

    # 7. Because You Watched — derive from recent interactions
    try:
        interactions_resp = await loop.run_in_executor(
            None,
            lambda: db.table("vlog_interactions")
            .select("vlog_id,action")
            .eq("user_id", user.user_id)
            .in_("action", ["save", "like"])
            .order("created_at", desc=True)
            .limit(5)
            .execute(),
        )
        liked_ids = [r["vlog_id"] for r in (interactions_resp.data or [])]
        if liked_ids:
            # Fetch those vlogs' styles and find similar content
            liked_vlogs_resp = await loop.run_in_executor(
                None,
                lambda: db.table("vlogs")
                .select("travel_styles,destinations")
                .in_("id", liked_ids)
                .execute(),
            )
            byw_styles: set[str] = set()
            for lv in (liked_vlogs_resp.data or []):
                byw_styles.update(lv.get("travel_styles") or [])

            if byw_styles:
                byw_style = next(iter(byw_styles))
                byw_result = await loop.run_in_executor(
                    None,
                    lambda: get_paginated_feed(user.user_id, limit=10, style=byw_style),
                )
                byw_vlogs = [
                    v for v in byw_result.get("vlogs", [])
                    if v["id"] not in set(liked_ids)
                ][:10]
                if byw_vlogs:
                    sections.append({
                        "id": "because_you_watched",
                        "title": "Because You Watched",
                        "emoji": "▶️",
                        "vlogs": byw_vlogs,
                    })
    except Exception as exc:
        logger.warning("Because You Watched section failed: %s", exc)

    return {"sections": sections}


@router.post("/refresh")
async def refresh_feed(background_tasks: BackgroundTasks, user: UserClaims = Depends(get_current_user)):
    background_tasks.add_task(build_feed_for_user, user.user_id)
    return {"ok": True, "message": "Feed refresh queued"}


@router.post("/seed")
async def seed_feed(background_tasks: BackgroundTasks, user: UserClaims = Depends(get_current_user)):
    """
    Seed the discovery pool with popular public travel vlogs from YouTube,
    TikTok, and Instagram, then rebuild this user's feed.
    """
    from app.api.v1.social import _seed_public_travel_vlogs
    from app.services.tiktok_service import seed_tiktok_travel_content
    from app.services.instagram_service import seed_instagram_travel_content

    db = get_supabase()

    async def _run():
        await _seed_public_travel_vlogs(db)
        try:
            seed_tiktok_travel_content(db, max_per_hashtag=6)
        except Exception as e:
            logger.warning("TikTok seed failed: %s", e)
        try:
            seed_instagram_travel_content(db, max_per_hashtag=6)
        except Exception as e:
            logger.warning("Instagram seed failed: %s", e)
        build_feed_for_user(user.user_id)

    background_tasks.add_task(_run)
    return {"ok": True, "message": "Seeding travel vlogs from all platforms and rebuilding your feed"}


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
            deduped.append(_flatten_vlog_itineraries(v))

    page = deduped[: body.limit]
    return {"vlogs": page, "next_cursor": None, "total": len(page)}
