"""
Background task: transcribe → build transcript graph → generate TripKit for a vlog.
Reads/writes to the new Prisma PostgreSQL schema.
"""
import logging

from app.db.pg_client import PgClient
from app.services.fusion_service import fuse_candidate_entities
from app.services.opportunity_publish_service import publish_tripkit_from_graph
from app.services.opportunity_ranking_service import rank_opportunities
from app.services.transcript_graph_service import sync_transcript_graph
from app.services.visual_evidence_service import sync_visual_evidence
from app.services.transcription_service import transcribe_vlog
from app.services.gemini_service import _mark_vlog_failed

logger = logging.getLogger(__name__)

TERMINAL_OR_ACTIVE_STATUSES = {
    "TRANSCRIBING",
    "EXTRACTING",
    "PREPROCESSING",
    "TRANSCRIPT_DONE",
    "VISION_DONE",
    "FUSED",
    "RESOLVED",
    "RANKED",
    "FUSED",
    "RANKED",
    "REVIEW_PENDING",
    "PUBLISHED",
    "COMPLETE",
}


def _update_vlog_status(vlog_id: str, status: str) -> None:
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "processingStatus" = %s, "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (status, vlog_id),
        )


def _update_vlog_pipeline_error(vlog_id: str, message: str) -> None:
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "pipelineError" = %s, "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (message, vlog_id),
        )


async def process_vlog_task(vlog_id: str) -> None:
    """Phase 3 pipeline: transcribe, persist transcript graph, add visual evidence, then publish TripKit."""
    logger.info(f"Processing vlog {vlog_id}")

    try:
        with PgClient() as db:
            db.execute(
                '''SELECT id, "processingStatus", "creatorId", title,
                          "durationSeconds", "thumbnailUrl"
                   FROM "Vlog" WHERE id = %s''',
                (vlog_id,)
            )
            vlog = db.fetchone()

        if not vlog:
            logger.error(f"Vlog {vlog_id} not found")
            return

        status = vlog["processingStatus"]
        if status in TERMINAL_OR_ACTIVE_STATUSES:
            logger.info(f"Vlog {vlog_id} already in status '{status}', skipping")
            return

        creator_id = vlog["creatorId"]
        title = vlog["title"]
        duration_seconds = vlog.get("durationSeconds")
        thumbnail_url = vlog.get("thumbnailUrl")

        # Step 1: Transcribe audio / fetch captions
        transcript = transcribe_vlog(vlog_id)
        if not transcript:
            logger.error(f"Transcription failed for vlog {vlog_id}")
            return

        # Step 2: Persist transcript graph records.
        sync_transcript_graph(vlog_id, creator_id, title, transcript)
        _update_vlog_status(vlog_id, "TRANSCRIPT_DONE")

        # Step 3: Best-effort visual evidence scaffolding. This should not
        # block transcript-backed opportunities from continuing through review.
        try:
            sync_visual_evidence(
                vlog_id,
                title,
                duration_seconds=duration_seconds,
                thumbnail_url=thumbnail_url,
            )
            _update_vlog_status(vlog_id, "VISION_DONE")
        except Exception as visual_error:
            logger.warning("Visual evidence sync failed for vlog %s: %s", vlog_id, visual_error)
            _update_vlog_pipeline_error(vlog_id, f"visual_evidence_failed: {visual_error}")

        # Step 4: Deterministic fusion across graph candidates.
        fuse_candidate_entities(vlog_id)
        _update_vlog_status(vlog_id, "FUSED")

        # Step 5: Deterministic ranking so review/publish ordering is code-owned.
        rank_opportunities(vlog_id)
        _update_vlog_status(vlog_id, "RANKED")

        _update_vlog_status(vlog_id, "REVIEW_PENDING")

        # Step 6: Publish storefront projection from approved/auto-approved
        # graph opportunities.
        success = publish_tripkit_from_graph(vlog_id)
        if not success:
            logger.info("Graph created reviewable opportunities for vlog %s; awaiting publish", vlog_id)
            return

        logger.info(f"Vlog {vlog_id} processed successfully")

    except Exception as e:
        logger.exception(f"Unexpected error processing vlog {vlog_id}: {e}")
        try:
            _mark_vlog_failed(vlog_id)
        except Exception:
            pass
