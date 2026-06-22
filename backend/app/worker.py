"""
Background worker for the durable job queue.

Run as a separate process alongside the API:  python -m app.worker

It polls the "Job" table, claims one job at a time (SKIP LOCKED so multiple
workers are safe), dispatches to the matching handler, and records the outcome.
Stale jobs (worker died mid-run) are periodically reaped back onto the queue.
"""
import asyncio
import inspect
import logging
import os
import socket

from app.services import job_queue
from app.tasks.analyze_channel import analyze_channel_task
from app.tasks.process_vlog import process_vlog_task

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5
REAP_EVERY_SECONDS = 300


async def _run_analyze_channel(payload: dict) -> None:
    await analyze_channel_task(payload["creator_id"], payload["creator_handle"])


async def _run_process_vlog(payload: dict) -> None:
    result = process_vlog_task(payload["vlog_id"])
    if inspect.isawaitable(result):
        await result


# Maps Job.type -> async handler(payload)
HANDLERS = {
    "analyze_channel": _run_analyze_channel,
    "process_vlog": _run_process_vlog,
}


async def run_job(job: dict) -> bool:
    """
    Execute a claimed job and record success/failure. Returns True on success.
    Never raises — a failing job is retried/failed via the queue, not propagated.
    """
    handler = HANDLERS.get(job["type"])
    if handler is None:
        job_queue.mark_failed(
            job["id"], f"no handler for job type '{job['type']}'",
            job["maxAttempts"], job["maxAttempts"],  # exhaust immediately
        )
        logger.error("No handler for job type %s (id=%s)", job["type"], job["id"])
        return False

    try:
        await handler(job["payload"])
        job_queue.mark_succeeded(job["id"])
        return True
    except Exception as e:
        status = job_queue.mark_failed(job["id"], str(e), job["attempts"], job["maxAttempts"])
        logger.exception(
            "Job %s (%s) failed on attempt %d/%d -> %s: %s",
            job["id"], job["type"], job["attempts"], job["maxAttempts"], status, e,
        )
        return False


async def work_once(worker_id: str) -> bool:
    """Claim and run a single job. Returns True if a job was processed."""
    job = job_queue.claim_next(worker_id)
    if job is None:
        return False
    await run_job(job)
    return True


async def run_forever(
    worker_id: str | None = None,
    poll_interval: int = POLL_INTERVAL_SECONDS,
    reap_every: int = REAP_EVERY_SECONDS,
) -> None:
    worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
    logger.info("Job worker %s starting", worker_id)
    seconds_since_reap = 0
    while True:
        try:
            did_work = await work_once(worker_id)
        except Exception as e:  # defensive: keep the loop alive
            logger.exception("worker loop error: %s", e)
            did_work = False

        if seconds_since_reap >= reap_every:
            try:
                job_queue.reap_stale()
            except Exception as e:
                logger.exception("reap_stale error: %s", e)
            seconds_since_reap = 0

        if not did_work:
            await asyncio.sleep(poll_interval)
            seconds_since_reap += poll_interval


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_forever())
