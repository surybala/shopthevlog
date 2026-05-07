"""
Insights endpoints — trigger channel analysis and fetch results.

Mirrors the vlogs.py pattern: auth guard → ownership check → background task.
POST /insights/analyze  — queue analysis for the authenticated creator
GET  /insights          — return latest ChannelInsight + ContentBriefs
POST /insights/augment  — augment a creator's rough video idea with personalized recommendations
"""
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import get_current_user, UserClaims
from app.db.pg_client import PgClient
from app.tasks.analyze_channel import analyze_channel_task
from app.services.insights_gemini_service import augment_creator_idea
from app.services.quota_service import check_and_consume_insights

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/insights", tags=["insights"])


@router.post("/analyze")
async def trigger_analysis(
    background_tasks: BackgroundTasks,
    user: UserClaims = Depends(get_current_user),
):
    """Queue a channel analysis run for the authenticated creator."""
    with PgClient() as db:
        db.execute(
            'SELECT id, handle FROM "Creator" WHERE "userId" = %s',
            (user.user_id,),
        )
        creator = db.fetchone()

    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")

    # Guard: skip if analysis is already in flight or result is still fresh
    with PgClient() as db:
        db.execute(
            'SELECT status, "analyzedAt" FROM "ChannelInsight" WHERE "creatorId" = %s',
            (creator["id"],),
        )
        existing = db.fetchone()

    if existing:
        if existing["status"] == "ANALYZING":
            return {"status": "ANALYZING", "message": "Analysis already running"}

        analyzed_at = existing["analyzedAt"]
        if existing["status"] == "COMPLETE" and analyzed_at is not None:
            if isinstance(analyzed_at, str):
                analyzed_at = datetime.fromisoformat(analyzed_at)
            if analyzed_at.tzinfo is None:
                analyzed_at = analyzed_at.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - analyzed_at).total_seconds() / 3600
            if age_hours < settings.INSIGHTS_CACHE_TTL_HOURS:
                remaining = settings.INSIGHTS_CACHE_TTL_HOURS - age_hours
                return {
                    "status": "CACHED",
                    "message": f"Insights are fresh ({age_hours:.1f}h old). Next refresh available in {remaining:.1f}h.",
                    "cached_at": analyzed_at.isoformat(),
                }

    quota = check_and_consume_insights(creator["id"])
    if not quota.allowed:
        raise HTTPException(
            status_code=402,
            detail=quota.to_error_detail("insights"),
        )

    background_tasks.add_task(analyze_channel_task, creator["id"], creator["handle"])
    return {"status": "QUEUED", "creator_id": creator["id"]}


@router.get("")
async def get_insights(user: UserClaims = Depends(get_current_user)):
    """Return the latest ChannelInsight and ContentBriefs for the creator."""
    with PgClient() as db:
        db.execute(
            'SELECT id FROM "Creator" WHERE "userId" = %s',
            (user.user_id,),
        )
        creator = db.fetchone()

    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")

    creator_id = creator["id"]

    with PgClient() as db:
        db.execute(
            '''SELECT id, status, "channelNiche", "topPatterns", "audienceDemands",
                      "analyzedVideoCount", "usedBenchmarks", "benchmarkVideoCount",
                      "analyzedAt", "updatedAt"
               FROM "ChannelInsight"
               WHERE "creatorId" = %s''',
            (creator_id,),
        )
        insight = db.fetchone()

    if not insight:
        return {"insight": None, "briefs": []}

    with PgClient() as db:
        db.execute(
            '''SELECT id, title, "hookIdeas", "contentOutline",
                      "trendSignal", "audienceSignal", "estimatedScore", reasoning, "createdAt"
               FROM "ContentBrief"
               WHERE "insightId" = %s
               ORDER BY "estimatedScore" DESC''',
            (insight["id"],),
        )
        briefs = [dict(row) for row in (db.fetchall() or [])]

    return {"insight": dict(insight), "briefs": briefs}


# ─── Idea Augmentation ────────────────────────────────────────────────────────

class AugmentIdeaRequest(BaseModel):
    idea: str = Field(..., min_length=10, max_length=2000)


@router.post("/augment")
async def augment_idea(
    body: AugmentIdeaRequest,
    user: UserClaims = Depends(get_current_user),
):
    """
    Augment a creator's rough video idea with personalized AI recommendations.
    Synchronous — typically takes 3-8 seconds. Persists and returns the result.
    """
    with PgClient() as db:
        db.execute(
            'SELECT id, handle FROM "Creator" WHERE "userId" = %s',
            (user.user_id,),
        )
        creator = db.fetchone()

    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")

    creator_id = creator["id"]
    creator_handle = creator["handle"]

    # Fetch channel insights for context
    with PgClient() as db:
        db.execute(
            'SELECT "topPatterns", "audienceDemands" FROM "ChannelInsight" WHERE "creatorId" = %s AND status = \'COMPLETE\'',
            (creator_id,),
        )
        insight = db.fetchone()

    patterns = {}
    audience = None
    if insight:
        try:
            patterns = json.loads(insight["topPatterns"]) if isinstance(insight["topPatterns"], str) else (insight["topPatterns"] or {})
        except Exception:
            patterns = {}
        try:
            audience = json.loads(insight["audienceDemands"]) if isinstance(insight["audienceDemands"], str) else insight["audienceDemands"]
        except Exception:
            audience = None

    # Fetch top performing vlogs for additional context
    with PgClient() as db:
        db.execute(
            '''SELECT title, "viewCount" FROM "Vlog"
               WHERE "creatorId" = %s AND "viewCount" IS NOT NULL
               ORDER BY "viewCount" DESC LIMIT 8''',
            (creator_id,),
        )
        top_vlogs = [dict(row) for row in (db.fetchall() or [])]

    result = augment_creator_idea(
        raw_idea=body.idea,
        patterns=patterns,
        audience=audience,
        creator_handle=creator_handle,
        top_vlogs=top_vlogs,
    )

    if not result:
        raise HTTPException(status_code=503, detail="Could not augment idea right now. Try again shortly.")

    # Persist the augmentation
    with PgClient() as db:
        db.execute(
            '''INSERT INTO "IdeaAugmentation"
               ("id", "creatorId", "rawIdea", "refinedTitles", "hookConcepts",
                "contentEnhancements", "audienceConnections", "nichelearnings",
                "overallAssessment", "confidenceScore", "createdAt")
               VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
               RETURNING id''',
            (
                creator_id,
                body.idea,
                json.dumps(result.get("refined_titles", [])),
                json.dumps(result.get("hook_concepts", [])),
                json.dumps(result.get("content_enhancements", [])),
                json.dumps(result.get("audience_connections", [])),
                json.dumps(result.get("niche_learnings", [])),
                result.get("overall_assessment", ""),
                result.get("confidence_score", 50),
            ),
        )
        row = db.fetchone()

    return {
        "id": row["id"] if row else None,
        "rawIdea": body.idea,
        "refinedTitles": result.get("refined_titles", []),
        "hookConcepts": result.get("hook_concepts", []),
        "contentEnhancements": result.get("content_enhancements", []),
        "audienceConnections": result.get("audience_connections", []),
        "nicheLearnings": result.get("niche_learnings", []),
        "overallAssessment": result.get("overall_assessment", ""),
        "confidenceScore": result.get("confidence_score", 50),
    }
