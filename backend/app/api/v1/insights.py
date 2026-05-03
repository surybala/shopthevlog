"""
Insights endpoints — trigger channel analysis and fetch results.

Mirrors the vlogs.py pattern: auth guard → ownership check → background task.
POST /insights/analyze  — queue analysis for the authenticated creator
GET  /insights          — return latest ChannelInsight + ContentBriefs
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

from app.core.security import get_current_user, UserClaims
from app.db.pg_client import PgClient
from app.tasks.analyze_channel import analyze_channel_task

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
