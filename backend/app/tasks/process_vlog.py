"""
Background task: transcribe → generate TripKit for a vlog.
Reads/writes to the new Prisma PostgreSQL schema.
"""
import logging

from app.db.pg_client import PgClient
from app.services.transcription_service import transcribe_vlog
from app.services.gemini_service import generate_trip_kit, _mark_vlog_failed

logger = logging.getLogger(__name__)


async def process_vlog_task(vlog_id: str) -> None:
    """Full pipeline: transcribe then generate TripKit."""
    logger.info(f"Processing vlog {vlog_id}")

    try:
        with PgClient() as db:
            db.execute(
                'SELECT id, "processingStatus", "creatorId", title FROM "Vlog" WHERE id = %s',
                (vlog_id,)
            )
            vlog = db.fetchone()

        if not vlog:
            logger.error(f"Vlog {vlog_id} not found")
            return

        status = vlog["processingStatus"]
        if status in ("TRANSCRIBING", "EXTRACTING", "COMPLETE"):
            logger.info(f"Vlog {vlog_id} already in status '{status}', skipping")
            return

        creator_id = vlog["creatorId"]
        title = vlog["title"]

        # Step 1: Transcribe audio / fetch captions
        transcript = transcribe_vlog(vlog_id)
        if not transcript:
            logger.error(f"Transcription failed for vlog {vlog_id}")
            return

        # Step 2: Generate TripKit via Claude
        success = generate_trip_kit(vlog_id, transcript, title, creator_id)
        if not success:
            logger.error(f"TripKit generation failed for vlog {vlog_id}")
            return

        logger.info(f"Vlog {vlog_id} processed successfully")

    except Exception as e:
        logger.exception(f"Unexpected error processing vlog {vlog_id}: {e}")
        try:
            _mark_vlog_failed(vlog_id)
        except Exception:
            pass
