"""
Feed ranking: score vlogs per user based on taste preferences and engagement signals.
"""
import logging
import math
from datetime import datetime, timezone

from app.db.client import get_supabase
from app.services.youtube_service import get_user_subscriptions

logger = logging.getLogger(__name__)

# Only the columns VlogCard actually needs — avoids fetching raw_transcript,
# description, processing_error, etc. (~60 % smaller payload per row).
_VLOG_COLS = (
    "id,platform,platform_video_id,title,thumbnail_url,channel_name,"
    "duration_seconds,published_at,view_count,like_count,"
    "destinations,travel_styles,processing_status,created_at,"
    "itineraries(id)"
)


def _overlap_score(a: list, b: list) -> float:
    """Jaccard-like overlap score between two lists."""
    if not a or not b:
        return 0.0
    a_set = {x.lower() for x in a}
    b_set = {x.lower() for x in b}
    intersection = a_set & b_set
    return len(intersection) / max(len(a_set), len(b_set))


def _recency_score(published_at: str | None) -> float:
    """Exponential decay: score=1 for today, ~0.5 for 30 days ago, ~0 for 6 months."""
    if not published_at:
        return 0.3
    try:
        pub = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - pub).days
        return math.exp(-age_days / 60)
    except Exception:
        return 0.3


def _engagement_score(view_count: int | None, like_count: int | None) -> float:
    """Log-normalized engagement, capped at 1.0."""
    views = view_count or 0
    likes = like_count or 0
    if views == 0:
        return 0.0
    log_views = math.log10(max(views, 1)) / 8  # log10(100M) ≈ 8
    like_ratio = min(likes / max(views, 1) * 10, 1.0)  # amplify like ratio
    return min((log_views + like_ratio) / 2, 1.0)


def build_feed_for_user(user_id: str) -> None:
    """
    Score all ready vlogs for this user and upsert into feed_cache.
    Signals used:
      - destination_match: overlap with user's preferred destinations
      - style_match: overlap with user's travel styles
      - subscription_score: boost for vlogs from YouTube channels the user subscribes to
      - engagement: log-normalised view/like counts
      - recency: exponential decay by publish date
    Home location is used as a penalty (deprioritise content about where the user lives).
    """
    db = get_supabase()

    # Load taste preferences (includes home_location)
    prefs_resp = db.table("taste_preferences").select("destinations,travel_styles,home_location").eq("user_id", user_id).execute()
    prefs = prefs_resp.data[0] if prefs_resp.data else {}
    pref_destinations = prefs.get("destinations", [])
    pref_styles = prefs.get("travel_styles", [])
    home_location = (prefs.get("home_location") or "").strip().lower()

    # Load YouTube subscriptions for this user (empty set if not connected)
    subscribed_channel_ids = get_user_subscriptions(user_id)

    # Load all ready vlogs (scoring columns only, including channel_id)
    vlogs_resp = db.table("vlogs").select(
        "id,destinations,travel_styles,published_at,view_count,like_count,channel_id"
    ).eq("processing_status", "ready").execute()
    vlogs = vlogs_resp.data or []

    # Load already-shown vlog IDs to de-prioritize
    shown_resp = db.table("feed_cache").select("vlog_id,shown").eq("user_id", user_id).execute()
    shown_ids = {row["vlog_id"] for row in (shown_resp.data or []) if row["shown"]}

    upsert_rows = []
    for vlog in vlogs:
        destination_match = _overlap_score(vlog.get("destinations", []), pref_destinations)
        style_match = _overlap_score(vlog.get("travel_styles", []), pref_styles)
        engagement = _engagement_score(vlog.get("view_count"), vlog.get("like_count"))
        recency = _recency_score(vlog.get("published_at"))

        # 1.0 if the vlog is from a channel the user subscribes to, else 0.0
        subscription_score = 1.0 if (
            subscribed_channel_ids and vlog.get("channel_id") in subscribed_channel_ids
        ) else 0.0

        score = (
            destination_match * 0.25
            + style_match * 0.20
            + subscription_score * 0.25
            + engagement * 0.15
            + recency * 0.15
        )

        # Penalise vlogs whose destinations overlap with the user's home location —
        # they already live there and are unlikely to want to travel there.
        if home_location:
            vlog_destinations_lower = [d.lower() for d in vlog.get("destinations", [])]
            if any(home_location in d or d in home_location for d in vlog_destinations_lower):
                score *= 0.4

        # Penalize already-shown
        if vlog["id"] in shown_ids:
            score *= 0.2

        reason_tags = []
        if destination_match > 0.3:
            reason_tags.append("destination_match")
        if style_match > 0.3:
            reason_tags.append("style_match")
        if engagement > 0.6:
            reason_tags.append("trending")
        if subscription_score > 0:
            reason_tags.append("subscribed_creator")

        upsert_rows.append({
            "user_id": user_id,
            "vlog_id": vlog["id"],
            "score": round(score, 4),
            "reason_tags": reason_tags,
            "shown": vlog["id"] in shown_ids,
        })

    if upsert_rows:
        db.table("feed_cache").upsert(upsert_rows, on_conflict="user_id,vlog_id").execute()

    logger.info(f"Feed built for user {user_id}: {len(upsert_rows)} vlogs scored")


def _mark_shown(db, user_id: str, vlog_ids: list[str]) -> None:
    """Fire-and-forget: mark vlogs as shown so they sink on the next rebuild."""
    if not vlog_ids:
        return
    try:
        db.table("feed_cache").update({"shown": True}).eq("user_id", user_id).in_("vlog_id", vlog_ids).execute()
    except Exception as e:
        logger.warning(f"mark_shown failed for user {user_id}: {e}")


def get_paginated_feed(
    user_id: str,
    cursor: str | None = None,
    limit: int = 20,
    destination: str | None = None,
    style: str | None = None,
) -> dict:
    """Return a scored, filtered feed page."""
    db = get_supabase()

    # Fetch limit+1 rows for has_next detection.
    # When filters are active we fetch 2× to absorb filter drop-off — still
    # far cheaper than the previous (limit+1)*3 = 63 rows with vlogs(*).
    fetch_limit = (limit + 1) * 2 if (destination or style) else limit + 1

    query = (
        db.table("feed_cache")
        .select(f"score, reason_tags, shown, vlogs({_VLOG_COLS})")
        .eq("user_id", user_id)
        .order("score", desc=True)
        .limit(fetch_limit)
    )

    if cursor:
        try:
            query = query.lt("score", float(cursor))
        except (ValueError, TypeError):
            pass

    resp = query.execute()
    rows = resp.data or []

    if not rows:
        return {"vlogs": [], "next_cursor": None, "total": 0, "_shown_ids": []}

    # Apply client-side filters (joined-column filtering not supported by Supabase SDK)
    dest_lower = destination.lower() if destination else None
    style_lower = style.lower() if style else None

    entries: list[tuple[dict, float]] = []
    for row in rows:
        v = row.get("vlogs") or {}
        if not v:
            continue
        # Flatten nested itineraries join → itinerary_id scalar
        itineraries = v.pop("itineraries", None) or []
        v["itinerary_id"] = itineraries[0]["id"] if itineraries else None
        if dest_lower and dest_lower not in [d.lower() for d in (v.get("destinations") or [])]:
            continue
        if style_lower and style_lower not in [s.lower() for s in (v.get("travel_styles") or [])]:
            continue
        entries.append((v, float(row.get("score", 0))))

    has_next = len(entries) > limit
    page_entries = entries[:limit]
    page_vlogs = [e[0] for e in page_entries]

    next_cursor = str(page_entries[-1][1]) if has_next and page_entries else None

    return {
        "vlogs": page_vlogs,
        "next_cursor": next_cursor,
        "total": len(page_vlogs),
        # Caller is responsible for scheduling shown-update as a background task
        "_shown_ids": [v["id"] for v in page_vlogs],
    }
