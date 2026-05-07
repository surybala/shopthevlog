"""
Internal trigger endpoints for the AI processing pipeline.
"""
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.core.security import get_current_user, UserClaims
from fastapi import Depends
from app.db.pg_client import PgClient
from app.tasks.process_vlog import process_vlog_task
from app.services.quota_service import check_and_consume_tripkit, remaining_tripkit_slots

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/scan/trigger")
async def trigger_scan(
    background_tasks: BackgroundTasks,
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

    # Resolve creator for quota checks
    with PgClient() as db:
        db.execute('SELECT id FROM "Creator" WHERE "userId" = %s', (user.user_id,))
        creator = db.fetchone()

    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")

    creator_id = creator["id"]
    slots = remaining_tripkit_slots(creator_id)

    all_vlog_ids = [v["id"] for v in vlogs]
    # Cap the batch to available quota slots
    eligible_ids = all_vlog_ids[:slots] if slots < len(all_vlog_ids) else all_vlog_ids
    skipped = len(all_vlog_ids) - len(eligible_ids)

    if not eligible_ids:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "quota_exceeded",
                "resource": "tripkits",
                "message": "Monthly TripKit quota exhausted. Upgrade your plan for more.",
            },
        )

    queued_ids: list[str] = []
    for vlog_id in eligible_ids:
        quota = check_and_consume_tripkit(creator_id)
        if not quota.allowed:
            # Quota ran out mid-batch (concurrent requests)
            break
        queued_ids.append(vlog_id)

    # Mark consumed vlogs as QUEUED
    with PgClient() as db:
        for vlog_id in queued_ids:
            db.execute(
                'UPDATE "Vlog" SET "processingStatus" = \'QUEUED\' WHERE id = %s',
                (vlog_id,)
            )

    for vlog_id in queued_ids:
        background_tasks.add_task(process_vlog_task, vlog_id)

    logger.info("Queued %d vlogs for user %s (skipped %d, quota limited)", len(queued_ids), user.user_id, skipped + (len(eligible_ids) - len(queued_ids)))
    return {
        "queued": len(queued_ids),
        "vlog_ids": queued_ids,
        "skipped_quota": skipped + (len(eligible_ids) - len(queued_ids)),
    }
