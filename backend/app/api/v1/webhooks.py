"""
Internal trigger endpoints for the AI processing pipeline.
"""
import logging
from fastapi import APIRouter, HTTPException

from app.core.security import get_current_user, UserClaims
from fastapi import Depends
from app.db.pg_client import PgClient
from app.services.job_queue import enqueue

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/scan/trigger")
async def trigger_scan(
    user: UserClaims = Depends(get_current_user),
):
    """
    Queue all PENDING or FAILED vlogs for the authenticated creator
    through the AI processing pipeline (transcription + TripKit generation).
    """
    with PgClient() as db:
        db.execute(
            '''SELECT v.id
               FROM "Vlog" v
               JOIN "Creator" c ON c.id = v."creatorId"
               WHERE c."userId" = %s
                 AND v."processingStatus" IN ('PENDING', 'FAILED')''',
            (user.user_id,)
        )
        vlogs = db.fetchall()

    if not vlogs:
        return {"queued": 0, "message": "No vlogs pending processing"}

    vlog_ids = [v["id"] for v in vlogs]

    # Mark all as QUEUED before handing off to background tasks
    with PgClient() as db:
        for vlog_id in vlog_ids:
            db.execute(
                'UPDATE "Vlog" SET "processingStatus" = \'QUEUED\' WHERE id = %s',
                (vlog_id,)
            )

    for vlog_id in vlog_ids:
        enqueue("process_vlog", {"vlog_id": vlog_id})

    logger.info(f"Queued {len(vlog_ids)} vlogs for user {user.user_id}")
    return {"queued": len(vlog_ids), "vlog_ids": vlog_ids}
