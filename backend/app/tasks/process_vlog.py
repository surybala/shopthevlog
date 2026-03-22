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
    """Full pipeline: transcribe then generate itinerary, then rebuild feeds."""
    logger.info(f"Processing vlog {vlog_id}")
    db = get_supabase()

    try:
        # Stamp 'transcribing' immediately so callers can distinguish
        # "queued but not started" (planning) from "actively running" (transcribing).
        db.table("vlogs").update({"processing_status": "transcribing"}).eq("id", vlog_id).execute()

        # Step 1: Transcribe
        transcript = transcribe_vlog(vlog_id)
        if not transcript:
            logger.error(f"Transcription failed for vlog {vlog_id}")
            return

        # Step 2: Fetch vlog title
        resp = db.table("vlogs").select("title").eq("id", vlog_id).single().execute()
        title = resp.data.get("title", "") if resp.data else ""

        # Step 3: Generate itinerary (sets processing_status → 'ready')
        success = generate_itinerary(vlog_id, transcript, title)
        if not success:
            logger.error(f"Itinerary generation failed for vlog {vlog_id}")
            return

        logger.info(f"Vlog {vlog_id} processed successfully — rebuilding affected feeds")

        # Step 4: Rebuild feed_cache for all users so the new ready vlog appears
        from app.services.feed_ranking_service import build_feed_for_user
        users_resp = db.table("profiles").select("id").execute()
        for row in (users_resp.data or []):
            try:
                build_feed_for_user(row["id"])
            except Exception as fe:
                logger.warning(f"Feed rebuild failed for user {row['id']}: {fe}")

    except Exception as e:
        logger.exception(f"Unexpected error processing vlog {vlog_id}: {e}")
        db.table("vlogs").update({
            "processing_status": "failed",
            "processing_error": str(e),
        }).eq("id", vlog_id).execute()
