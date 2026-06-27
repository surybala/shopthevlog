"""
Tests for app.services.quota_service — plan limits, atomic consume, and reset logic.

Each test patches PgClient at the quota_service import site and supplies
a sequence of FakePgClient instances (one per `with PgClient() as db:` call).
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from tests.conftest import FakePgClient
from app.services.quota_service import (
    check_and_consume_tripkit,
    check_and_consume_insights,
    remaining_tripkit_slots,
    PLAN_LIMITS,
    QuotaResult,
    _needs_reset,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _this_month() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _last_month() -> datetime:
    first = _this_month()
    return (first - timedelta(days=1)).replace(day=1)


def _pg_seq(*row_lists: list[dict]) -> MagicMock:
    """Return a mock PgClient constructor that yields FakePgClients in sequence."""
    clients = [FakePgClient(rows) for rows in row_lists]
    idx = {"i": 0}

    def _factory():
        client = clients[idx["i"] % len(clients)]
        idx["i"] += 1
        return client

    return _factory


# ─── _needs_reset ─────────────────────────────────────────────────────────────

class TestNeedsReset:
    def test_none_needs_reset(self):
        assert _needs_reset(None) is True

    def test_last_month_needs_reset(self):
        assert _needs_reset(_last_month()) is True

    def test_this_month_does_not_need_reset(self):
        assert _needs_reset(_this_month()) is False

    def test_iso_string_this_month(self):
        assert _needs_reset(_this_month().isoformat()) is False

    def test_naive_datetime_treated_as_utc(self):
        naive = _this_month().replace(tzinfo=None)
        assert _needs_reset(naive) is False


# ─── PLAN_LIMITS ──────────────────────────────────────────────────────────────

class TestPlanLimits:
    def test_free_limits(self):
        assert PLAN_LIMITS["FREE"]["tripkits"] == 3
        assert PLAN_LIMITS["FREE"]["insights"] == 25

    def test_pro_limits(self):
        assert PLAN_LIMITS["PRO"]["tripkits"] == 25
        assert PLAN_LIMITS["PRO"]["insights"] == 100

    def test_studio_limits(self):
        assert PLAN_LIMITS["STUDIO"]["tripkits"] == 75
        assert PLAN_LIMITS["STUDIO"]["insights"] == 500


# ─── check_and_consume_tripkit ────────────────────────────────────────────────

class TestCheckAndConsumeTripkit:
    def test_allowed_within_limit(self):
        reset_at = _this_month()
        # SELECT returns used=1 (below FREE cap of 3)
        # No reset needed → skip UPDATE for reset
        # RETURNING UPDATE returns used=2
        select_rows = [{"plan": "FREE", "processingCreditsUsed": 1, "processingCreditsResetAt": reset_at}]
        update_rows = [{"processingCreditsUsed": 2, "processingCreditsResetAt": reset_at}]

        clients = [FakePgClient(select_rows), FakePgClient(update_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_tripkit("creator-1")

        assert result.allowed is True
        assert result.used == 2
        assert result.limit == 3
        assert result.remaining == 1

    def test_denied_at_limit(self):
        reset_at = _this_month()
        select_rows = [{"plan": "FREE", "processingCreditsUsed": 3, "processingCreditsResetAt": reset_at}]

        with patch("app.services.quota_service.PgClient", return_value=FakePgClient(select_rows)):
            result = check_and_consume_tripkit("creator-1")

        assert result.allowed is False
        assert result.remaining == 0

    def test_resets_stale_counter_then_allows(self):
        # Counter is at 3 but from last month — should reset to 0 and allow
        old_reset = _last_month()
        select_rows = [{"plan": "FREE", "processingCreditsUsed": 3, "processingCreditsResetAt": old_reset}]
        reset_update_rows: list[dict] = []  # UPDATE for reset, no RETURNING needed
        consume_rows = [{"processingCreditsUsed": 1, "processingCreditsResetAt": _this_month()}]

        clients = [
            FakePgClient(select_rows),
            FakePgClient(reset_update_rows),  # reset UPDATE
            FakePgClient(consume_rows),        # consume UPDATE
        ]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_tripkit("creator-1")

        assert result.allowed is True
        assert result.used == 1

    def test_creator_not_found_returns_denied(self):
        with patch("app.services.quota_service.PgClient", return_value=FakePgClient([])):
            result = check_and_consume_tripkit("nonexistent")

        assert result.allowed is False

    def test_race_condition_returns_denied(self):
        """RETURNING UPDATE returns nothing — another request consumed the last credit."""
        reset_at = _this_month()
        select_rows = [{"plan": "FREE", "processingCreditsUsed": 2, "processingCreditsResetAt": reset_at}]
        no_rows: list[dict] = []  # atomic UPDATE found used >= cap

        clients = [FakePgClient(select_rows), FakePgClient(no_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_tripkit("creator-1")

        assert result.allowed is False

    def test_pro_plan_higher_limit(self):
        reset_at = _this_month()
        select_rows = [{"plan": "PRO", "processingCreditsUsed": 24, "processingCreditsResetAt": reset_at}]
        update_rows = [{"processingCreditsUsed": 25, "processingCreditsResetAt": reset_at}]

        clients = [FakePgClient(select_rows), FakePgClient(update_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_tripkit("creator-2")

        assert result.allowed is True
        assert result.limit == 25

    def test_to_error_detail_shape(self):
        reset_at = _this_month()
        result = QuotaResult(allowed=False, plan="FREE", used=3, limit=3, reset_at=reset_at)
        detail = result.to_error_detail("tripkits")

        assert detail["error"] == "quota_exceeded"
        assert detail["resource"] == "tripkits"
        assert detail["remaining"] == 0
        assert "upgrade_hint" in detail


# ─── check_and_consume_insights ───────────────────────────────────────────────

class TestCheckAndConsumeInsights:
    def test_allowed_within_limit(self):
        reset_at = _this_month()
        select_rows = [{"plan": "PRO", "insightsRunsUsed": 50, "insightsRunsResetAt": reset_at}]
        update_rows = [{"insightsRunsUsed": 51, "insightsRunsResetAt": reset_at}]

        clients = [FakePgClient(select_rows), FakePgClient(update_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_insights("creator-1")

        assert result.allowed is True
        assert result.used == 51
        assert result.limit == 100

    def test_denied_at_free_limit(self):
        reset_at = _this_month()
        select_rows = [{"plan": "FREE", "insightsRunsUsed": 25, "insightsRunsResetAt": reset_at}]

        with patch("app.services.quota_service.PgClient", return_value=FakePgClient(select_rows)):
            result = check_and_consume_insights("creator-1")

        assert result.allowed is False
        assert result.limit == 25

    def test_resets_stale_counter(self):
        old_reset = _last_month()
        select_rows = [{"plan": "FREE", "insightsRunsUsed": 25, "insightsRunsResetAt": old_reset}]
        reset_rows: list[dict] = []
        consume_rows = [{"insightsRunsUsed": 1, "insightsRunsResetAt": _this_month()}]

        clients = [FakePgClient(select_rows), FakePgClient(reset_rows), FakePgClient(consume_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_insights("creator-1")

        assert result.allowed is True

    def test_creator_not_found(self):
        with patch("app.services.quota_service.PgClient", return_value=FakePgClient([])):
            result = check_and_consume_insights("ghost")

        assert result.allowed is False

    def test_studio_plan_500_limit(self):
        reset_at = _this_month()
        select_rows = [{"plan": "STUDIO", "insightsRunsUsed": 499, "insightsRunsResetAt": reset_at}]
        update_rows = [{"insightsRunsUsed": 500, "insightsRunsResetAt": reset_at}]

        clients = [FakePgClient(select_rows), FakePgClient(update_rows)]
        idx = {"i": 0}
        def factory():
            c = clients[idx["i"] % len(clients)]
            idx["i"] += 1
            return c

        with patch("app.services.quota_service.PgClient", side_effect=factory):
            result = check_and_consume_insights("creator-3")

        assert result.allowed is True
        assert result.limit == 500


# ─── remaining_tripkit_slots ──────────────────────────────────────────────────

class TestRemainingTripkitSlots:
    def test_returns_remaining_for_current_month(self):
        reset_at = _this_month()
        rows = [{"plan": "FREE", "processingCreditsUsed": 1, "processingCreditsResetAt": reset_at}]

        with patch("app.services.quota_service.PgClient", return_value=FakePgClient(rows)):
            slots = remaining_tripkit_slots("creator-1")

        assert slots == 2  # 3 - 1

    def test_returns_full_cap_after_stale_reset(self):
        rows = [{"plan": "PRO", "processingCreditsUsed": 25, "processingCreditsResetAt": _last_month()}]

        with patch("app.services.quota_service.PgClient", return_value=FakePgClient(rows)):
            slots = remaining_tripkit_slots("creator-1")

        assert slots == 25  # full PRO cap

    def test_returns_zero_at_cap(self):
        reset_at = _this_month()
        rows = [{"plan": "FREE", "processingCreditsUsed": 3, "processingCreditsResetAt": reset_at}]

        with patch("app.services.quota_service.PgClient", return_value=FakePgClient(rows)):
            slots = remaining_tripkit_slots("creator-1")

        assert slots == 0

    def test_returns_zero_for_unknown_creator(self):
        with patch("app.services.quota_service.PgClient", return_value=FakePgClient([])):
            slots = remaining_tripkit_slots("nobody")

        assert slots == 0
