"""
Durable, Postgres-backed job queue.

Long-running pipeline work (channel analysis, vlog processing) is enqueued as a
row in the "Job" table instead of a fire-and-forget FastAPI BackgroundTask, so
it survives worker restarts, retries with backoff on failure, and is never left
stuck (a reaper requeues jobs whose worker died mid-run).

Jobs are claimed atomically with SELECT ... FOR UPDATE SKIP LOCKED, so many
workers can poll the same queue without double-processing.
"""
import json
import logging
from typing import Optional

from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

DEFAULT_MAX_ATTEMPTS = 3
# Stale = claimed (RUNNING) longer than this; assume the worker died.
DEFAULT_STALE_SECONDS = 900  # 15 minutes
# Exponential-ish backoff (seconds) indexed by attempts already made.
_RETRY_BACKOFF_SECONDS = [60, 300, 900]


def _loads(value):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if value else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def enqueue(
    job_type: str,
    payload: dict,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    run_after_seconds: int = 0,
) -> Optional[str]:
    """Insert a job and return its id. Returns None on failure (never raises)."""
    try:
        with PgClient() as db:
            db.execute(
                '''INSERT INTO "Job" (id, type, payload, status, attempts, "maxAttempts",
                                      "runAfter", "createdAt", "updatedAt")
                   VALUES (gen_random_uuid()::text, %s, %s, 'PENDING', 0, %s,
                           NOW() + (%s * INTERVAL '1 second'), NOW(), NOW())
                   RETURNING id''',
                (job_type, json.dumps(payload or {}), max_attempts, run_after_seconds),
            )
            row = db.fetchone()
            return row["id"] if row else None
    except Exception as e:
        logger.exception("enqueue failed for job_type=%s: %s", job_type, e)
        return None


def claim_next(worker_id: str) -> Optional[dict]:
    """
    Atomically claim the next runnable job (PENDING and due), marking it RUNNING
    and incrementing attempts. Returns the claimed job dict or None if the queue
    is empty. Concurrency-safe via FOR UPDATE SKIP LOCKED.
    """
    with PgClient() as db:
        db.execute(
            '''UPDATE "Job"
               SET status = 'RUNNING',
                   "lockedAt" = NOW(),
                   "lockedBy" = %s,
                   attempts = attempts + 1,
                   "updatedAt" = NOW()
               WHERE id = (
                   SELECT id FROM "Job"
                   WHERE status = 'PENDING' AND "runAfter" <= NOW()
                   ORDER BY "runAfter" ASC
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1
               )
               RETURNING id, type, payload, attempts, "maxAttempts"''',
            (worker_id,),
        )
        row = db.fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "type": row["type"],
        "payload": _loads(row["payload"]),
        "attempts": row["attempts"],
        "maxAttempts": row["maxAttempts"],
    }


def mark_succeeded(job_id: str) -> None:
    with PgClient() as db:
        db.execute(
            '''UPDATE "Job"
               SET status = 'SUCCEEDED', "lockedAt" = NULL, "lockedBy" = NULL,
                   "lastError" = NULL, "updatedAt" = NOW()
               WHERE id = %s''',
            (job_id,),
        )


def _backoff_seconds(attempts: int) -> int:
    idx = min(max(attempts - 1, 0), len(_RETRY_BACKOFF_SECONDS) - 1)
    return _RETRY_BACKOFF_SECONDS[idx]


def mark_failed(job_id: str, error: str, attempts: int, max_attempts: int) -> str:
    """
    Record a failure. If attempts remain, requeue (PENDING) with backoff;
    otherwise mark FAILED permanently. Returns the resulting status.
    """
    error_text = (error or "")[:1000]
    if attempts < max_attempts:
        backoff = _backoff_seconds(attempts)
        with PgClient() as db:
            db.execute(
                '''UPDATE "Job"
                   SET status = 'PENDING', "lockedAt" = NULL, "lockedBy" = NULL,
                       "lastError" = %s,
                       "runAfter" = NOW() + (%s * INTERVAL '1 second'),
                       "updatedAt" = NOW()
                   WHERE id = %s''',
                (error_text, backoff, job_id),
            )
        return "PENDING"
    with PgClient() as db:
        db.execute(
            '''UPDATE "Job"
               SET status = 'FAILED', "lockedAt" = NULL, "lockedBy" = NULL,
                   "lastError" = %s, "updatedAt" = NOW()
               WHERE id = %s''',
            (error_text, job_id),
        )
    return "FAILED"


def reap_stale(stale_seconds: int = DEFAULT_STALE_SECONDS) -> int:
    """
    Requeue jobs stuck in RUNNING past the stale threshold (worker presumed dead).
    Jobs that still have attempts left go back to PENDING; exhausted ones are
    marked FAILED. Returns the number of jobs reaped.
    """
    with PgClient() as db:
        db.execute(
            '''UPDATE "Job"
               SET status = CASE WHEN attempts < "maxAttempts" THEN 'PENDING'::"JobStatus"
                                 ELSE 'FAILED'::"JobStatus" END,
                   "lockedAt" = NULL,
                   "lockedBy" = NULL,
                   "lastError" = COALESCE("lastError", 'reaped: worker timeout'),
                   "updatedAt" = NOW()
               WHERE status = 'RUNNING'
                 AND "lockedAt" < NOW() - (%s * INTERVAL '1 second')
               RETURNING id''',
            (stale_seconds,),
        )
        rows = db.fetchall() or []
    if rows:
        logger.warning("Reaped %d stale job(s)", len(rows))
    return len(rows)
