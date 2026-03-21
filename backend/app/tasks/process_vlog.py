"""
Background task: transcribe → generate itinerary for a vlog.
Can be called via FastAPI BackgroundTasks or ARQ worker.
"""
import logging

from app.services.transcription_service import transcribe_vlog
from app.services.claude_service import generate_itinerary
from app.db.client import get_supabase

logger = logging.getLogger(__name__)


async def process_vlog_task(vlog_id: str) -> None:
    """Full pipeline: transcribe then generate itinerary."""
    logger.info(f"Processing vlog {vlog_id}")
    db = get_supabase()

    try:
        # Step 1: Transcribe
        transcript = transcribe_vlog(vlog_id)
        if not transcript:
            logger.error(f"Transcription failed for vlog {vlog_id}")
            return

        # Step 2: Fetch vlog title
        resp = db.table("vlogs").select("title").eq("id", vlog_id).single().execute()
        title = resp.data.get("title", "") if resp.data else ""

        # Step 3: Generate itinerary
        success = generate_itinerary(vlog_id, transcript, title)
        if success:
            logger.info(f"Vlog {vlog_id} processed successfully")
        else:
            logger.error(f"Itinerary generation failed for vlog {vlog_id}")

    except Exception as e:
        logger.exception(f"Unexpected error processing vlog {vlog_id}: {e}")
        db.table("vlogs").update({
            "processing_status": "failed",
            "processing_error": str(e),
        }).eq("id", vlog_id).execute()
