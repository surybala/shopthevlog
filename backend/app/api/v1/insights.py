"""
Insights endpoints — trigger channel analysis and fetch results.

Mirrors the vlogs.py pattern: auth guard → ownership check → background task.
POST /insights/analyze  — queue analysis for the authenticated creator
GET  /insights          — return latest ChannelInsight + ContentBriefs
POST /insights/augment  — augment a creator's rough video idea with personalized recommendations
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.core.security import get_current_user, UserClaims
from app.db.pg_client import PgClient
from app.tasks.analyze_channel import analyze_channel_task
from app.services.insights_gemini_service import augment_creator_idea
from app.services.brief_outcomes import fetch_calibration_context
from app.services.niche_service import fetch_niche_trends
from app.services.gap_analysis import compute_gap_map

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

    # Guard: skip if analysis is already in flight
    with PgClient() as db:
        db.execute(
            'SELECT status FROM "ChannelInsight" WHERE "creatorId" = %s',
            (creator["id"],),
        )
        existing = db.fetchone()

    if existing and existing["status"] == "ANALYZING":
        return {"status": "ANALYZING", "message": "Analysis already running"}

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
            'SELECT id, handle, "nicheId" FROM "Creator" WHERE "userId" = %s',
            (user.user_id,),
        )
        creator = db.fetchone()

    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")

    creator_id = creator["id"]
    creator_handle = creator["handle"]
    niche_id = creator.get("nicheId")

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

    # Fetch the creator's videos for context + gap-map coverage
    with PgClient() as db:
        db.execute(
            '''SELECT title, "viewCount" FROM "Vlog"
               WHERE "creatorId" = %s AND "viewCount" IS NOT NULL
               ORDER BY "viewCount" DESC LIMIT 40''',
            (creator_id,),
        )
        creator_vlogs = [dict(row) for row in (db.fetchall() or [])]

    top_vlogs = creator_vlogs[:8]
    vlog_titles = [v.get("title") for v in creator_vlogs if v.get("title")]

    # Live niche signals: current trends + demand/coverage whitespace
    niche_trends = fetch_niche_trends(niche_id) if niche_id else []
    gap_map = compute_gap_map(audience, niche_trends, vlog_titles)
    calibration = fetch_calibration_context(creator_id)

    result = augment_creator_idea(
        raw_idea=body.idea,
        patterns=patterns,
        audience=audience,
        creator_handle=creator_handle,
        top_vlogs=top_vlogs,
        calibration=calibration,
        niche_trends=niche_trends,
        gap_map=gap_map,
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
        # Surface the live signals the recommendation was grounded in so the UI
        # can show creators *why* — making the personalization visible.
        "liveSignals": {
            "nicheTrends": [
                {"topic": t.get("topic"), "momentum": t.get("momentum"), "score": t.get("score")}
                for t in (niche_trends or [])[:5]
            ],
            "gaps": [
                {"topic": g.get("topic"), "momentum": g.get("momentum"), "coverageCount": g.get("coverage_count")}
                for g in (gap_map or [])[:5]
            ],
        },
    }
