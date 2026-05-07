"""
Usage metering and tier enforcement for TripKit generation and insights runs.

Each plan has a monthly quota for TripKits and insights runs. Quotas reset
on a rolling monthly basis (calendar month from last reset or account creation).

Atomic enforcement: a single UPDATE with a WHERE limit check prevents
overshooting quotas under concurrent requests.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

# ─── Plan limits ──────────────────────────────────────────────────────────────

PLAN_LIMITS: dict[str, dict[str, int]] = {
    "FREE":   {"tripkits": 3,   "insights": 25},
    "PRO":    {"tripkits": 25,  "insights": 100},
    "STUDIO": {"tripkits": 75,  "insights": 500},
}

_FALLBACK_PLAN = "FREE"


def _limit(plan: str, resource: str) -> int:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS[_FALLBACK_PLAN])[resource]


# ─── Result type ──────────────────────────────────────────────────────────────

@dataclass
class QuotaResult:
    allowed: bool
    plan: str
    used: int
    limit: int
    reset_at: datetime | None

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    def to_error_detail(self, resource: str) -> dict:
        return {
            "error": "quota_exceeded",
            "resource": resource,
            "plan": self.plan,
            "used": self.used,
            "limit": self.limit,
            "remaining": 0,
            "reset_at": self.reset_at.isoformat() if self.reset_at else None,
            "upgrade_hint": "Upgrade your plan to increase your monthly quota.",
        }


# ─── Reset helpers ────────────────────────────────────────────────────────────

def _needs_reset(reset_at: datetime | None) -> bool:
    """True when the reset timestamp is absent or in a past calendar month."""
    if reset_at is None:
        return True
    if isinstance(reset_at, str):
        reset_at = datetime.fromisoformat(reset_at)
    if reset_at.tzinfo is None:
        reset_at = reset_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return (now.year, now.month) > (reset_at.year, reset_at.month)


# ─── TripKit quota ────────────────────────────────────────────────────────────

def check_and_consume_tripkit(creator_id: str) -> QuotaResult:
    """
    Atomically check and consume one TripKit credit for creator_id.

    Returns QuotaResult(allowed=True) if the credit was consumed, or
    QuotaResult(allowed=False) if the plan quota is exhausted.
    """
    with PgClient() as db:
        db.execute(
            '''SELECT plan, "processingCreditsUsed", "processingCreditsResetAt"
               FROM "Creator" WHERE id = %s''',
            (creator_id,),
        )
        row = db.fetchone()

    if not row:
        logger.warning("check_and_consume_tripkit: creator %s not found", creator_id)
        return QuotaResult(allowed=False, plan=_FALLBACK_PLAN, used=0, limit=0, reset_at=None)

    plan = row["plan"]
    cap = _limit(plan, "tripkits")

    # Roll over counter if we're in a new calendar month
    if _needs_reset(row["processingCreditsResetAt"]):
        with PgClient() as db:
            db.execute(
                '''UPDATE "Creator"
                   SET "processingCreditsUsed" = 0,
                       "processingCreditsResetAt" = NOW()
                   WHERE id = %s''',
                (creator_id,),
            )
        used_before = 0
    else:
        used_before = row["processingCreditsUsed"]

    if used_before >= cap:
        return QuotaResult(
            allowed=False, plan=plan, used=used_before, limit=cap,
            reset_at=row["processingCreditsResetAt"],
        )

    # Atomic increment — only succeeds if still under cap
    with PgClient() as db:
        db.execute(
            '''UPDATE "Creator"
               SET "processingCreditsUsed" = "processingCreditsUsed" + 1,
                   "processingCreditsResetAt" = COALESCE("processingCreditsResetAt", NOW())
               WHERE id = %s AND "processingCreditsUsed" < %s
               RETURNING "processingCreditsUsed", "processingCreditsResetAt"''',
            (creator_id, cap),
        )
        updated = db.fetchone()

    if not updated:
        # Race condition: another request consumed the last credit
        return QuotaResult(allowed=False, plan=plan, used=cap, limit=cap, reset_at=None)

    return QuotaResult(
        allowed=True,
        plan=plan,
        used=updated["processingCreditsUsed"],
        limit=cap,
        reset_at=updated["processingCreditsResetAt"],
    )


# ─── Insights quota ───────────────────────────────────────────────────────────

def check_and_consume_insights(creator_id: str) -> QuotaResult:
    """
    Atomically check and consume one insights-run credit for creator_id.

    Returns QuotaResult(allowed=True) if the credit was consumed, or
    QuotaResult(allowed=False) if the plan quota is exhausted.
    """
    with PgClient() as db:
        db.execute(
            '''SELECT plan, "insightsRunsUsed", "insightsRunsResetAt"
               FROM "Creator" WHERE id = %s''',
            (creator_id,),
        )
        row = db.fetchone()

    if not row:
        logger.warning("check_and_consume_insights: creator %s not found", creator_id)
        return QuotaResult(allowed=False, plan=_FALLBACK_PLAN, used=0, limit=0, reset_at=None)

    plan = row["plan"]
    cap = _limit(plan, "insights")

    if _needs_reset(row["insightsRunsResetAt"]):
        with PgClient() as db:
            db.execute(
                '''UPDATE "Creator"
                   SET "insightsRunsUsed" = 0,
                       "insightsRunsResetAt" = NOW()
                   WHERE id = %s''',
                (creator_id,),
            )
        used_before = 0
    else:
        used_before = row["insightsRunsUsed"]

    if used_before >= cap:
        return QuotaResult(
            allowed=False, plan=plan, used=used_before, limit=cap,
            reset_at=row["insightsRunsResetAt"],
        )

    with PgClient() as db:
        db.execute(
            '''UPDATE "Creator"
               SET "insightsRunsUsed" = "insightsRunsUsed" + 1,
                   "insightsRunsResetAt" = COALESCE("insightsRunsResetAt", NOW())
               WHERE id = %s AND "insightsRunsUsed" < %s
               RETURNING "insightsRunsUsed", "insightsRunsResetAt"''',
            (creator_id, cap),
        )
        updated = db.fetchone()

    if not updated:
        return QuotaResult(allowed=False, plan=plan, used=cap, limit=cap, reset_at=None)

    return QuotaResult(
        allowed=True,
        plan=plan,
        used=updated["insightsRunsUsed"],
        limit=cap,
        reset_at=updated["insightsRunsResetAt"],
    )


# ─── Remaining slots helper (for bulk endpoints) ──────────────────────────────

def remaining_tripkit_slots(creator_id: str) -> int:
    """
    Return how many TripKit slots remain this month without consuming any.
    Used by the bulk scan endpoint to cap how many vlogs get queued.
    """
    with PgClient() as db:
        db.execute(
            '''SELECT plan, "processingCreditsUsed", "processingCreditsResetAt"
               FROM "Creator" WHERE id = %s''',
            (creator_id,),
        )
        row = db.fetchone()

    if not row:
        return 0

    plan = row["plan"]
    cap = _limit(plan, "tripkits")

    if _needs_reset(row["processingCreditsResetAt"]):
        return cap

    return max(0, cap - row["processingCreditsUsed"])
