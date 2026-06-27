"""
Durable daily cost guardrails for costly external APIs (#3).

A first-cohort launch can quietly blow the YouTube Data API daily quota (a single
search costs 100 of ~10k units) or run up Gemini spend. This guard keeps a
Postgres-backed per-day counter per resource so a budget / circuit breaker holds
across instances and restarts — claimed atomically so concurrent workers can't
race past the cap.

Design choices:
  - Fail-OPEN: if the counter DB call errors, we allow the request rather than
    break onboarding — a cost guard must never be the thing that takes us down.
  - Disable-able via settings.COST_GUARD_ENABLED for tests / emergencies.
  - When a resource is blocked we emit an observability event so it's visible.
"""
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.core.observability import observability_store
from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

# Resource keys (also the stored ApiUsageCounter.resource values)
RESOURCE_YOUTUBE = "youtube_units"
RESOURCE_GEMINI = "gemini_calls"

# Cost per call, in the resource's own units
YOUTUBE_SEARCH_UNITS = 101   # search.list (100) + videos.list (1)
YOUTUBE_LOOKUP_UNITS = 1     # channels.list / commentThreads.list


def _today():
    return datetime.now(timezone.utc).date()


def _budget_for(resource: str) -> int:
    if resource == RESOURCE_YOUTUBE:
        return settings.YOUTUBE_DAILY_UNIT_BUDGET
    if resource == RESOURCE_GEMINI:
        return settings.GEMINI_DAILY_CALL_BUDGET
    return 0


def _record_block(resource: str) -> None:
    observability_store.record(
        kind="cost_guard", name=resource, status="blocked",
        detail="daily_budget_exceeded",
    )


def consume(resource: str, amount: int = 1, budget: int | None = None) -> bool:
    """
    Atomically reserve `amount` units of `resource` for today.
    Returns True if allowed (within budget), False if it would exceed the budget.

    A budget <= 0 means "unlimited". Disabled guard always allows. DB errors
    fail open (allow) so the guard can never break the pipeline.
    """
    if not settings.COST_GUARD_ENABLED:
        return True
    if budget is None:
        budget = _budget_for(resource)
    if budget <= 0:
        return True
    if amount > budget:
        _record_block(resource)
        return False

    try:
        with PgClient() as db:
            db.execute(
                '''INSERT INTO "ApiUsageCounter" (id, resource, day, used, "updatedAt")
                   VALUES (gen_random_uuid()::text, %s, %s, %s, NOW())
                   ON CONFLICT (resource, day) DO UPDATE
                     SET used = "ApiUsageCounter".used + EXCLUDED.used,
                         "updatedAt" = NOW()
                     WHERE "ApiUsageCounter".used + EXCLUDED.used <= %s
                   RETURNING used''',
                (resource, _today(), amount, budget),
            )
            row = db.fetchone()
    except Exception as e:
        logger.warning("quota_guard.consume failed for %s (fail-open): %s", resource, e)
        return True

    if row is None:
        # Conflict update was skipped because it would exceed the budget.
        _record_block(resource)
        return False
    return True


def usage_today(resource: str) -> int:
    """Units consumed for `resource` so far today (0 on miss / error)."""
    try:
        with PgClient() as db:
            db.execute(
                'SELECT used FROM "ApiUsageCounter" WHERE resource = %s AND day = %s',
                (resource, _today()),
            )
            row = db.fetchone()
        return int((row or {}).get("used") or 0)
    except Exception as e:
        logger.warning("quota_guard.usage_today failed for %s: %s", resource, e)
        return 0


def usage_snapshot() -> list[dict]:
    """Per-resource budget status for observability / admin surfaces."""
    snapshot = []
    for resource in (RESOURCE_YOUTUBE, RESOURCE_GEMINI):
        used = usage_today(resource)
        budget = _budget_for(resource)
        snapshot.append({
            "resource": resource,
            "used": used,
            "budget": budget,
            "remaining": max(budget - used, 0) if budget > 0 else None,
            "enabled": settings.COST_GUARD_ENABLED,
        })
    return snapshot
