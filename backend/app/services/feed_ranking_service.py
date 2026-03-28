"""
Feed ranking: score vlogs per user based on taste preferences and engagement signals.
"""
import logging
import math
from datetime import datetime, timedelta, timezone

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
      - interaction_boost: lift for styles/destinations the user actively engages with
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

    # ── Interaction-based interest signals ───────────────────────────────────
    # Derive implicit preferences from recent interactions (saves, likes, views).
    # Weight: save=3, like=2, view=1.
    interactions_resp = (
        db.table("vlog_interactions")
        .select("vlog_id,action")
        .eq("user_id", user_id)
        .in_("action", ["view", "like", "save"])
        .execute()
    )
    interacted_vlog_ids = {r["vlog_id"]: r["action"] for r in (interactions_resp.data or [])}
    action_weight = {"save": 3, "like": 2, "view": 1}

    # Collect the styles/destinations of vlogs the user has interacted with
    implied_styles: dict[str, float] = {}   # style → accumulated weight
    implied_dests: dict[str, float] = {}    # dest  → accumulated weight
    if interacted_vlog_ids:
        iv_resp = (
            db.table("vlogs")
            .select("id,destinations,travel_styles")
            .in_("id", list(interacted_vlog_ids.keys()))
            .execute()
        )
        for iv in (iv_resp.data or []):
            w = action_weight.get(interacted_vlog_ids.get(iv["id"], "view"), 1)
            for s in (iv.get("travel_styles") or []):
                implied_styles[s.lower()] = implied_styles.get(s.lower(), 0) + w
            for d in (iv.get("destinations") or []):
                implied_dests[d.lower()] = implied_dests.get(d.lower(), 0) + w

    # Normalise implied scores to [0, 1]
    max_style_w = max(implied_styles.values(), default=1)
    max_dest_w = max(implied_dests.values(), default=1)

    # Load all ready vlogs (scoring columns only, including channel_id)
    vlogs_resp = db.table("vlogs").select(
        "id,platform,destinations,travel_styles,published_at,view_count,like_count,channel_id"
    ).eq("processing_status", "ready").execute()
    vlogs = vlogs_resp.data or []

    # Load already-shown vlog IDs to de-prioritize
    shown_resp = db.table("feed_cache").select("vlog_id,shown").eq("user_id", user_id).execute()
    shown_ids = {row["vlog_id"] for row in (shown_resp.data or []) if row["shown"]}

    upsert_rows = []
    for vlog in vlogs:
        vlog_styles = vlog.get("travel_styles") or []
        vlog_dests = vlog.get("destinations") or []

        destination_match = _overlap_score(vlog_dests, pref_destinations)
        style_match = _overlap_score(vlog_styles, pref_styles)
        engagement = _engagement_score(vlog.get("view_count"), vlog.get("like_count"))
        recency = _recency_score(vlog.get("published_at"))

        # 1.0 if the vlog is from a channel the user subscribes to, else 0.0
        subscription_score = 1.0 if (
            subscribed_channel_ids and vlog.get("channel_id") in subscribed_channel_ids
        ) else 0.0

        # Implicit interaction boost: average normalised weight across matching styles/dests
        style_boost = 0.0
        if implied_styles:
            matching = [implied_styles.get(s.lower(), 0) for s in vlog_styles if s.lower() in implied_styles]
            style_boost = (sum(matching) / len(matching) / max_style_w) if matching else 0.0

        dest_boost = 0.0
        if implied_dests:
            matching = [implied_dests.get(d.lower(), 0) for d in vlog_dests if d.lower() in implied_dests]
            dest_boost = (sum(matching) / len(matching) / max_dest_w) if matching else 0.0

        interaction_boost = (style_boost * 0.6 + dest_boost * 0.4)

        score = (
            destination_match * 0.22
            + style_match * 0.18
            + subscription_score * 0.20
            + engagement * 0.15
            + recency * 0.15
            + interaction_boost * 0.10
        )

        # Penalise vlogs whose destinations overlap with the user's home location —
        # they already live there and are unlikely to want to travel there.
        if home_location:
            vlog_destinations_lower = [d.lower() for d in vlog_dests]
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
        if interaction_boost > 0.4:
            reason_tags.append("because_you_watched")

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


def _flatten_vlog_itineraries(v: dict) -> dict:
    """Inline-flatten the nested itineraries join into a scalar itinerary_id."""
    itineraries = v.pop("itineraries", None)
    if isinstance(itineraries, dict):
        v["itinerary_id"] = itineraries.get("id")
    elif isinstance(itineraries, list) and itineraries:
        v["itinerary_id"] = itineraries[0]["id"]
    else:
        v["itinerary_id"] = None
    return v


def _matches_duration(dur_secs: int, duration_lower: str) -> bool:
    if duration_lower == "short":
        return dur_secs < 600
    if duration_lower == "medium":
        return 600 <= dur_secs < 1800
    if duration_lower == "long":
        return dur_secs >= 1800
    return True


def _query_vlogs_direct(
    db,
    style: str | None = None,
    platform: str | None = None,
    duration: str | None = None,
    exclude_ids: set[str] | None = None,
    limit: int = 20,
) -> list[tuple[dict, float]]:
    """
    Query the vlogs table directly (bypassing feed_cache) when filters produce
    too few results from the ranked cache.  Sorted by engagement (view_count desc).
    Returns list of (vlog_dict, pseudo_score) tuples.
    """
    query = (
        db.table("vlogs")
        .select(_VLOG_COLS)
        .eq("processing_status", "ready")
        .order("view_count", desc=True)
        .limit(limit * 5)  # over-fetch so we can apply in-Python filters
    )

    if platform:
        query = query.eq("platform", platform)

    # Apply duration at DB level when possible
    if duration:
        if duration == "short":
            query = query.lt("duration_seconds", 600)
        elif duration == "medium":
            query = query.gte("duration_seconds", 600).lt("duration_seconds", 1800)
        elif duration == "long":
            query = query.gte("duration_seconds", 1800)

    resp = query.execute()
    rows = resp.data or []

    style_lower = style.lower().strip() if style else None
    results: list[tuple[dict, float]] = []

    for v in rows:
        if exclude_ids and v.get("id") in exclude_ids:
            continue

        # Style filter — generous: array match OR title keyword
        if style_lower:
            vlog_styles = [s.lower() for s in (v.get("travel_styles") or [])]
            title_lower = (v.get("title") or "").lower()
            style_in_array = any(style_lower in s or s in style_lower for s in vlog_styles)
            style_in_title = style_lower in title_lower
            if not (style_in_array or style_in_title):
                continue

        _flatten_vlog_itineraries(v)

        # Pseudo-score based on engagement so caller can merge/sort uniformly
        views = v.get("view_count") or 0
        pseudo_score = math.log10(max(views, 1)) / 8
        results.append((v, pseudo_score))

        if len(results) >= limit:
            break

    return results


def get_trending_vlogs(limit: int = 12, platform: str | None = None) -> list[dict]:
    """
    Return the most-viewed ready vlogs, optionally filtered by platform.
    Used for the Trending Now section of the Discover page.
    """
    db = get_supabase()
    query = (
        db.table("vlogs")
        .select(_VLOG_COLS)
        .eq("processing_status", "ready")
        .order("view_count", desc=True)
        .limit(limit)
    )
    if platform:
        query = query.eq("platform", platform)

    resp = query.execute()
    return [_flatten_vlog_itineraries(v) for v in (resp.data or [])]


def get_new_this_week(limit: int = 12) -> list[dict]:
    """Return vlogs added to the DB in the last 7 days, newest first."""
    db = get_supabase()
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    resp = (
        db.table("vlogs")
        .select(_VLOG_COLS)
        .eq("processing_status", "ready")
        .gte("created_at", week_ago)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [_flatten_vlog_itineraries(v) for v in (resp.data or [])]


def get_vlogs_by_platform(platform: str, limit: int = 12) -> list[dict]:
    """Return top vlogs for a specific platform (tiktok, instagram, youtube)."""
    db = get_supabase()
    resp = (
        db.table("vlogs")
        .select(_VLOG_COLS)
        .eq("processing_status", "ready")
        .eq("platform", platform)
        .order("view_count", desc=True)
        .limit(limit)
        .execute()
    )
    return [_flatten_vlog_itineraries(v) for v in (resp.data or [])]


def get_paginated_feed(
    user_id: str,
    cursor: str | None = None,
    limit: int = 20,
    destination: str | None = None,
    style: str | None = None,
    duration: str | None = None,
    platform: str | None = None,
) -> dict:
    """Return a scored, filtered feed page.

    Strategy:
    1. Query feed_cache (personalized scores) with a generous over-fetch.
    2. Apply destination / style / duration / platform filters in Python.
    3. If style / platform filters still yield fewer than `limit` results,
       fall back to a direct vlogs-table query sorted by engagement.
    """
    db = get_supabase()

    # Fetch generously when filters are active so we don't miss matches
    active_filters = bool(destination or style or duration or platform)
    # Fetch up to 200 rows from feed_cache when filtering; otherwise just limit+1
    fetch_limit = 200 if active_filters else limit + 1

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

    if not rows and not active_filters:
        return {"vlogs": [], "next_cursor": None, "total": 0, "_shown_ids": []}

    # Normalise filter values once
    dest_lower = destination.lower().strip() if destination else None
    style_lower = style.lower().strip() if style else None
    duration_lower = duration.lower().strip() if duration else None
    platform_lower = platform.lower().strip() if platform else None

    entries: list[tuple[dict, float]] = []
    for row in rows:
        v = row.get("vlogs") or {}
        if not v:
            continue

        _flatten_vlog_itineraries(v)

        # ── Platform filter ────────────────────────────────────────────────
        if platform_lower and (v.get("platform") or "").lower() != platform_lower:
            continue

        # ── Destination filter ─────────────────────────────────────────────
        if dest_lower:
            vlog_dests = [d.lower() for d in (v.get("destinations") or [])]
            title_lower = (v.get("title") or "").lower()
            channel_lower = (v.get("channel_name") or "").lower()
            dest_in_array = any(dest_lower in d or d in dest_lower for d in vlog_dests)
            dest_in_title = dest_lower in title_lower
            dest_in_channel = dest_lower in channel_lower
            if not (dest_in_array or dest_in_title or dest_in_channel):
                continue

        # ── Style filter ───────────────────────────────────────────────────
        if style_lower:
            vlog_styles = [s.lower() for s in (v.get("travel_styles") or [])]
            title_lower = (v.get("title") or "").lower()
            style_in_array = any(style_lower in s or s in style_lower for s in vlog_styles)
            style_in_title = style_lower in title_lower
            if not (style_in_array or style_in_title):
                continue

        # ── Duration filter ────────────────────────────────────────────────
        if duration_lower:
            dur_secs = v.get("duration_seconds") or 0
            if not _matches_duration(dur_secs, duration_lower):
                continue

        entries.append((v, float(row.get("score", 0))))

    # ── Fallback: supplement with direct DB query when cache is thin ────────
    # This covers style/platform filters where tag data quality may be low:
    # vlogs seeded before the AI classifier ran may have empty arrays, so we
    # fall back to a direct vlogs-table query sorted by engagement.
    # Duration is always stored with the video and doesn't need a fallback.
    if len(entries) < limit and (style_lower or platform_lower):
        seen_ids = {e[0]["id"] for e in entries}
        supplement = _query_vlogs_direct(
            db,
            style=style,
            platform=platform_lower,
            duration=duration_lower,
            exclude_ids=seen_ids,
            limit=limit - len(entries),
        )
        entries.extend(supplement)

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
