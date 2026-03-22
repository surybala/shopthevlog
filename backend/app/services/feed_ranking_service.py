"""
Feed ranking: score vlogs per user based on taste preferences and engagement signals.
"""
import logging
import math
from datetime import datetime, timezone

from app.db.client import get_supabase

logger = logging.getLogger(__name__)

# Only the columns VlogCard actually needs — avoids fetching raw_transcript,
# description, processing_error, etc. (~60 % smaller payload per row).
_VLOG_COLS = (
    "id,platform,platform_video_id,title,thumbnail_url,channel_name,"
    "duration_seconds,published_at,view_count,like_count,"
    "destinations,travel_styles,processing_status,created_at"
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
    Called after onboarding, new vlog ingest, or explicit refresh.
    """
    db = get_supabase()

    # Load taste preferences
    prefs_resp = db.table("taste_preferences").select("destinations,travel_styles").eq("user_id", user_id).execute()
    prefs = prefs_resp.data[0] if prefs_resp.data else {}
    pref_destinations = prefs.get("destinations", [])
    pref_styles = prefs.get("travel_styles", [])

    # Load all ready vlogs (scoring columns only)
    vlogs_resp = db.table("vlogs").select("id,destinations,travel_styles,published_at,view_count,like_count").eq("processing_status", "ready").execute()
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

        score = (
            destination_match * 0.35
            + style_match * 0.30
            + engagement * 0.20
            + recency * 0.15
        )

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

    # Cache miss on first page — build synchronously then retry once.
    if not rows and not cursor:
        logger.info(f"Feed cache empty for {user_id}, building now")
        build_feed_for_user(user_id)
        resp = query.execute()
        rows = resp.data or []
        if not rows:
            return {"vlogs": [], "next_cursor": None, "total": 0}

    # Apply client-side filters (joined-column filtering not supported by Supabase SDK)
    dest_lower = destination.lower() if destination else None
    style_lower = style.lower() if style else None

    entries: list[tuple[dict, float]] = []
    for row in rows:
        v = row.get("vlogs") or {}
        if not v:
            continue
        if dest_lower and dest_lower not in [d.lower() for d in v.get("destinations", [])]:
            continue
        if style_lower and style_lower not in [s.lower() for s in v.get("travel_styles", [])]:
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
