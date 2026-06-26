"""
Tests for the durable cost guardrails (#3).

DB access is mocked via FakePgClient. The guard is disabled globally in tests
(conftest), so each test that exercises enforcement enables it explicitly.
"""
from unittest.mock import patch

import pytest

from tests.conftest import FakePgClient


@pytest.fixture
def guard_enabled(monkeypatch):
    monkeypatch.setattr("app.services.quota_guard.settings.COST_GUARD_ENABLED", True)


# ─── consume ──────────────────────────────────────────────────────────────────

class TestConsume:
    def test_allows_when_guard_disabled(self, monkeypatch):
        monkeypatch.setattr("app.services.quota_guard.settings.COST_GUARD_ENABLED", False)
        from app.services import quota_guard
        # No PgClient should be touched when disabled
        with patch("app.services.quota_guard.PgClient", side_effect=AssertionError("should not query")):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 101) is True

    def test_allows_under_budget(self, guard_enabled):
        from app.services import quota_guard
        client = FakePgClient(rows=[{"used": 101}])
        with patch("app.services.quota_guard.PgClient", return_value=client):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 101, budget=9000) is True

    def test_blocks_when_conflict_update_skipped(self, guard_enabled):
        from app.services import quota_guard
        from app.core.observability import observability_store
        observability_store.reset()
        # Empty result => the conditional ON CONFLICT update was skipped (over budget)
        client = FakePgClient(rows=[])
        with patch("app.services.quota_guard.PgClient", return_value=client):
            assert quota_guard.consume(quota_guard.RESOURCE_GEMINI, 1, budget=5000) is False
        events = list(observability_store._events)
        assert any(e.kind == "cost_guard" and e.status == "blocked" for e in events)

    def test_blocks_when_amount_exceeds_budget(self, guard_enabled):
        from app.services import quota_guard
        with patch("app.services.quota_guard.PgClient", side_effect=AssertionError("should not query")):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 50, budget=10) is False

    def test_unlimited_when_budget_zero(self, guard_enabled):
        from app.services import quota_guard
        with patch("app.services.quota_guard.PgClient", side_effect=AssertionError("should not query")):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 999999, budget=0) is True

    def test_fails_open_on_db_error(self, guard_enabled):
        from app.services import quota_guard
        with patch("app.services.quota_guard.PgClient", side_effect=RuntimeError("db down")):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 101, budget=9000) is True

    def test_uses_configured_budget_by_resource(self, guard_enabled, monkeypatch):
        from app.services import quota_guard
        monkeypatch.setattr("app.services.quota_guard.settings.YOUTUBE_DAILY_UNIT_BUDGET", 5)
        # amount 10 > resource budget 5 => blocked without a DB call
        with patch("app.services.quota_guard.PgClient", side_effect=AssertionError("should not query")):
            assert quota_guard.consume(quota_guard.RESOURCE_YOUTUBE, 10) is False


# ─── usage reads ──────────────────────────────────────────────────────────────

class TestUsageReads:
    def test_usage_today_returns_used(self):
        from app.services import quota_guard
        client = FakePgClient(rows=[{"used": 250}])
        with patch("app.services.quota_guard.PgClient", return_value=client):
            assert quota_guard.usage_today(quota_guard.RESOURCE_YOUTUBE) == 250

    def test_usage_today_zero_when_missing(self):
        from app.services import quota_guard
        client = FakePgClient(rows=[])
        with patch("app.services.quota_guard.PgClient", return_value=client):
            assert quota_guard.usage_today(quota_guard.RESOURCE_GEMINI) == 0

    def test_usage_today_zero_on_error(self):
        from app.services import quota_guard
        with patch("app.services.quota_guard.PgClient", side_effect=RuntimeError("db")):
            assert quota_guard.usage_today(quota_guard.RESOURCE_YOUTUBE) == 0

    def test_usage_snapshot_shape(self, guard_enabled):
        from app.services import quota_guard
        client = FakePgClient(rows=[{"used": 100}])
        with patch("app.services.quota_guard.PgClient", return_value=client):
            snap = quota_guard.usage_snapshot()
        resources = {row["resource"] for row in snap}
        assert resources == {quota_guard.RESOURCE_YOUTUBE, quota_guard.RESOURCE_GEMINI}
        for row in snap:
            assert row["used"] == 100
            assert row["remaining"] == row["budget"] - 100


# ─── integration: call sites degrade gracefully when blocked ─────────────────

class TestYouTubeCallSitesBlocked:
    def test_search_benchmarks_returns_empty_when_blocked(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        with patch("app.services.quota_guard.consume", return_value=False):
            from app.services.analytics_service import search_niche_benchmarks
            assert search_niche_benchmarks("japan budget", recency_days=90) == []

    def test_peer_channels_returns_empty_when_blocked(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        with patch("app.services.quota_guard.consume", return_value=False):
            from app.services.analytics_service import find_peer_channels
            assert find_peer_channels(["c1", "c2"]) == []

    def test_comments_returns_empty_when_blocked(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        with patch("app.services.quota_guard.consume", return_value=False):
            from app.services.analytics_service import fetch_video_comments
            assert fetch_video_comments("yt_abc") == []


class TestGeminiBudgetBlocked:
    def test_call_gemini_raises_when_blocked(self):
        from app.services.gemini_service import _call_gemini
        with patch("app.services.quota_guard.consume", return_value=False):
            with pytest.raises(RuntimeError, match="budget"):
                _call_gemini("system", "user", 100)

    def test_pattern_analysis_degrades_to_none_when_blocked(self):
        # The Gemini budget exception must surface as graceful None, not a crash.
        from app.services.insights_gemini_service import analyze_content_patterns
        with patch("app.services.quota_guard.consume", return_value=False):
            result = analyze_content_patterns(
                [{"title": "Japan budget", "viewCount": 1000, "transcript_excerpt": "..."}],
                "creator",
            )
        assert result is None


def test_unknown_resource_has_no_budget(monkeypatch):
    monkeypatch.setattr("app.services.quota_guard.settings.COST_GUARD_ENABLED", True)
    from app.services import quota_guard
    # Unknown resource resolves to budget 0 => unlimited => allowed, no DB call
    with patch("app.services.quota_guard.PgClient", side_effect=AssertionError("should not query")):
        assert quota_guard.consume("mystery_api", 10) is True
