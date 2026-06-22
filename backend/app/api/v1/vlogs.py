"""
Vlog endpoints — list, status check, and per-vlog processing trigger.
All reads/writes use the new Prisma PostgreSQL schema.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user, UserClaims
from app.db.pg_client import PgClient
from app.services.job_queue import enqueue

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vlogs", tags=["vlogs"])


@router.get("")
async def list_vlogs(user: UserClaims = Depends(get_current_user)):
    """List all vlogs for the authenticated creator, newest first."""
    with PgClient() as db:
        db.execute(
            '''SELECT v.id, v.title, v.description, v."thumbnailUrl",
                      v."externalUrl", v."publishedAt", v."processingStatus",
                      v."processedAt", v.platform,
                      tov."tripKitId",
                      tk.title AS "tripKitTitle",
                      tk."isPublished" AS "tripKitPublished"
               FROM "Vlog" v
               JOIN "Creator" c ON c.id = v."creatorId"
               LEFT JOIN "TripKitsOnVlogs" tov ON tov."vlogId" = v.id
               LEFT JOIN "TripKit" tk ON tk.id = tov."tripKitId"
               WHERE c."userId" = %s
               ORDER BY v."publishedAt" DESC NULLS LAST''',
            (user.user_id,)
        )
        vlogs = db.fetchall()
    return {"vlogs": [dict(v) for v in (vlogs or [])]}


@router.post("/{vlog_id}/process")
async def trigger_process(
    vlog_id: str,
    user: UserClaims = Depends(get_current_user),
):
    """Trigger AI processing (transcription + TripKit generation) for a vlog."""
    with PgClient() as db:
        db.execute(
            '''SELECT v.id, v."processingStatus",
                      EXISTS(
                          SELECT 1
                          FROM "Opportunity" opp
                          WHERE opp."vlogId" = v.id
                      ) AS "hasOpportunities"
               FROM "Vlog" v
               JOIN "Creator" c ON c.id = v."creatorId"
               WHERE v.id = %s AND c."userId" = %s''',
            (vlog_id, user.user_id)
        )
        vlog = db.fetchone()

    if not vlog:
        raise HTTPException(status_code=404, detail="Vlog not found")

    if vlog["processingStatus"] in ("TRANSCRIBING", "EXTRACTING"):
        return {"status": vlog["processingStatus"], "message": "Already processing"}

    if vlog.get("hasOpportunities"):
        return {
            "status": "REVIEW_PENDING",
            "message": "Already processed; review opportunities already exist",
        }

    with PgClient() as db:
        db.execute(
            'UPDATE "Vlog" SET "processingStatus" = \'QUEUED\' WHERE id = %s',
            (vlog_id,)
        )

    enqueue("process_vlog", {"vlog_id": vlog_id})
    return {"status": "QUEUED", "vlog_id": vlog_id}


@router.get("/{vlog_id}/status")
async def get_vlog_status(
    vlog_id: str,
    user: UserClaims = Depends(get_current_user),
):
    """Get processing status and linked TripKit for a vlog."""
    with PgClient() as db:
        db.execute(
            '''SELECT v.id, v."processingStatus", v."processedAt",
                      tov."tripKitId",
                      tk.title AS "tripKitTitle",
                      tk."isPublished" AS "tripKitPublished"
               FROM "Vlog" v
               JOIN "Creator" c ON c.id = v."creatorId"
               LEFT JOIN "TripKitsOnVlogs" tov ON tov."vlogId" = v.id
               LEFT JOIN "TripKit" tk ON tk.id = tov."tripKitId"
               WHERE v.id = %s AND c."userId" = %s''',
            (vlog_id, user.user_id)
        )
        row = db.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Vlog not found")

    return dict(row)
