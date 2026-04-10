"""
Background task: transcribe, build the graph, and stop at review readiness.
Reads and writes to the Prisma PostgreSQL schema.
"""
import logging
import time

from app.core.observability import observability_store
from app.db.pg_client import PgClient
from app.services.fusion_service import fuse_candidate_entities
from app.services.opportunity_ranking_service import rank_opportunities
from app.services.resolution_service import resolve_candidates
from app.services.transcript_graph_service import sync_transcript_graph
from app.services.visual_enrichment_service import enrich_visual_graph
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
    """Process a vlog through extraction, fusion, resolution, and review readiness."""
    logger.info("Processing vlog %s", vlog_id)
    started_at = time.perf_counter()

    try:
        with PgClient() as db:
            db.execute(
                '''SELECT id, "processingStatus", "creatorId", title,
                          "durationSeconds", "thumbnailUrl", "externalUrl",
                          EXISTS(
                              SELECT 1
                              FROM "Opportunity" opp
                              WHERE opp."vlogId" = "Vlog".id
                          ) AS "hasOpportunities"
                   FROM "Vlog" WHERE id = %s''',
                (vlog_id,),
            )
            vlog = db.fetchone()

        if not vlog:
            logger.error("Vlog %s not found", vlog_id)
            observability_store.record(kind="pipeline", name="process_vlog", status="skipped", detail="missing_vlog")
            return

        status = vlog["processingStatus"]
        if status in TERMINAL_OR_ACTIVE_STATUSES:
            logger.info("Vlog %s already in status '%s', skipping", vlog_id, status)
            observability_store.record(kind="pipeline", name="process_vlog", status="skipped", detail=f"status:{status}")
            return

        if vlog.get("hasOpportunities"):
            logger.info("Vlog %s already has graph opportunities, skipping reprocessing", vlog_id)
            observability_store.record(kind="pipeline", name="process_vlog", status="skipped", detail="has_opportunities")
            return

        creator_id = vlog["creatorId"]
        title = vlog["title"]
        duration_seconds = vlog.get("durationSeconds")
        thumbnail_url = vlog.get("thumbnailUrl")
        external_video_url = vlog.get("externalUrl")

        transcript = transcribe_vlog(vlog_id)
        if not transcript:
            logger.error("Transcription failed for vlog %s", vlog_id)
            return

        transcript_summary = sync_transcript_graph(vlog_id, creator_id, title, transcript)
        _update_vlog_status(vlog_id, "TRANSCRIPT_DONE")

        visual_opportunity_count = 0
        visual_error_message: str | None = None
        try:
            sync_visual_evidence(
                vlog_id,
                creator_id,
                title,
                duration_seconds=duration_seconds,
                external_video_url=external_video_url,
                thumbnail_url=thumbnail_url,
            )
            visual_summary = enrich_visual_graph(vlog_id, creator_id, title) or {}
            visual_opportunity_count = int(visual_summary.get("opportunities") or 0)
            _update_vlog_status(vlog_id, "VISION_DONE")
        except Exception as visual_error:
            logger.warning("Visual evidence sync failed for vlog %s: %s", vlog_id, visual_error)
            visual_error_message = f"visual_evidence_failed: {visual_error}"
            _update_vlog_pipeline_error(vlog_id, visual_error_message)

        total_opportunities = int(transcript_summary.get("opportunities") or 0) + visual_opportunity_count
        if total_opportunities <= 0:
            failure_reason = "no_opportunities_extracted"
            if visual_error_message:
                failure_reason = f"{failure_reason}; {visual_error_message}"
            logger.warning("No reviewable opportunities created for vlog %s (%s)", vlog_id, failure_reason)
            _update_vlog_pipeline_error(vlog_id, failure_reason)
            _mark_vlog_failed(vlog_id)
            observability_store.record(
                kind="pipeline",
                name="process_vlog",
                status="failed",
                duration_ms=(time.perf_counter() - started_at) * 1000,
                detail="no_opportunities",
            )
            return

        fuse_candidate_entities(vlog_id)
        _update_vlog_status(vlog_id, "FUSED")

        resolve_candidates(vlog_id)
        _update_vlog_status(vlog_id, "RESOLVED")

        rank_opportunities(vlog_id)
        _update_vlog_status(vlog_id, "RANKED")

        _update_vlog_status(vlog_id, "REVIEW_PENDING")
        logger.info("Graph created reviewable opportunities for vlog %s; awaiting creator publish", vlog_id)
        observability_store.record(
            kind="pipeline",
            name="process_vlog",
            status="success",
            duration_ms=(time.perf_counter() - started_at) * 1000,
        )

    except Exception as error:
        logger.exception("Unexpected error processing vlog %s: %s", vlog_id, error)
        observability_store.record(
            kind="pipeline",
            name="process_vlog",
            status="failed",
            duration_ms=(time.perf_counter() - started_at) * 1000,
            detail=type(error).__name__,
        )
        try:
            _mark_vlog_failed(vlog_id)
        except Exception:
            pass
