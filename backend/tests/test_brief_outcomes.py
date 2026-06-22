"""
Tests for brief outcome calibration (Phase 3).

DB access is mocked via FakePgClient. Mirrors test_niche_service.py.
"""
import json
from unittest.mock import patch

from tests.conftest import FakePgClient


# ─── baseline ─────────────────────────────────────────────────────────────────

class TestFetchCreatorBaseline:
    def test_returns_median_views(self):
        client = FakePgClient(rows=[{"viewCount": 100}, {"viewCount": 300}, {"viewCount": 200}])
        with patch("app.services.brief_outcomes.PgClient", return_value=client):
            from app.services.brief_outcomes import fetch_creator_baseline
            assert fetch_creator_baseline("creator-1") == 200.0

    def test_zero_when_no_vlogs(self):
        client = FakePgClient(rows=[])
        with patch("app.services.brief_outcomes.PgClient", return_value=client):
            from app.services.brief_outcomes import fetch_creator_baseline
            assert fetch_creator_baseline("creator-1") == 0.0

    def test_zero_on_db_error(self):
        with patch("app.services.brief_outcomes.PgClient", side_effect=RuntimeError("db")):
            from app.services.brief_outcomes import fetch_creator_baseline
            assert fetch_creator_baseline("creator-1") == 0.0


# ─── calibration context ──────────────────────────────────────────────────────

class TestFetchCalibrationContext:
    def test_no_samples_returns_baseline_only(self):
        # First PgClient call (briefs) → empty; second (baseline) → views
        briefs_client = FakePgClient(rows=[])
        baseline_client = FakePgClient(rows=[{"viewCount": 1000}])
        calls = [0]

        def _factory(*a, **k):
            calls[0] += 1
            return briefs_client if calls[0] == 1 else baseline_client

        with patch("app.services.brief_outcomes.PgClient", side_effect=_factory):
            from app.services.brief_outcomes import fetch_calibration_context
            ctx = fetch_calibration_context("creator-1")
        assert ctx["samples"] == []
        assert ctx["baseline_median_views"] == 1000.0
        assert ctx["mean_abs_error"] is None

    def test_computes_mean_abs_error(self):
        briefs = [
            {"title": "A", "estimatedScore": 80, "actualScore": 60, "outcomeDelta": -0.2},
            {"title": "B", "estimatedScore": 50, "actualScore": 70, "outcomeDelta": 0.4},
        ]
        briefs_client = FakePgClient(rows=briefs)
        baseline_client = FakePgClient(rows=[{"viewCount": 500}])
        calls = [0]

        def _factory(*a, **k):
            calls[0] += 1
            return briefs_client if calls[0] == 1 else baseline_client

        with patch("app.services.brief_outcomes.PgClient", side_effect=_factory):
            from app.services.brief_outcomes import fetch_calibration_context
            ctx = fetch_calibration_context("creator-1")
        assert len(ctx["samples"]) == 2
        # |80-60|=20, |50-70|=20 → mean 20
        assert ctx["mean_abs_error"] == 20.0

    def test_handles_db_error_gracefully(self):
        with patch("app.services.brief_outcomes.PgClient", side_effect=RuntimeError("db")):
            from app.services.brief_outcomes import fetch_calibration_context
            ctx = fetch_calibration_context("creator-1")
        assert ctx["samples"] == []
        assert ctx["baseline_median_views"] == 0.0


# ─── prompt section formatting ────────────────────────────────────────────────

class TestFormatCalibrationSection:
    def test_empty_for_none(self):
        from app.services.brief_outcomes import format_calibration_section
        assert format_calibration_section(None) == ""

    def test_empty_when_no_signal(self):
        from app.services.brief_outcomes import format_calibration_section
        assert format_calibration_section({"baseline_median_views": 0, "samples": [], "mean_abs_error": None}) == ""

    def test_renders_baseline_only(self):
        from app.services.brief_outcomes import format_calibration_section
        out = format_calibration_section({"baseline_median_views": 12345, "samples": [], "mean_abs_error": None})
        assert "CALIBRATION" in out
        assert "12,345" in out

    def test_renders_samples_and_mae(self):
        from app.services.brief_outcomes import format_calibration_section
        ctx = {
            "baseline_median_views": 5000,
            "samples": [{"title": "Japan trip", "estimatedScore": 80, "actualScore": 65, "outcomeDelta": 0.3}],
            "mean_abs_error": 15.0,
        }
        out = format_calibration_section(ctx)
        assert "Japan trip" in out
        assert "+30% vs baseline" in out
        assert "15 points" in out

    def test_handles_missing_outcome_delta(self):
        from app.services.brief_outcomes import format_calibration_section
        ctx = {
            "baseline_median_views": 5000,
            "samples": [{"title": "X", "estimatedScore": 70, "actualScore": 50, "outcomeDelta": None}],
            "mean_abs_error": 20.0,
        }
        out = format_calibration_section(ctx)
        assert "outcome n/a" in out


# ─── calibration reaches the prompts ──────────────────────────────────────────

class TestCalibrationInPrompts:
    def test_briefs_prompt_includes_calibration(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"briefs": []})

        calibration = {"baseline_median_views": 5000, "samples": [], "mean_abs_error": None}
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_cap):
            from app.services.insights_gemini_service import generate_content_briefs
            generate_content_briefs({"channel_niche": "x"}, None, "creator", calibration=calibration)
        assert "CALIBRATION" in captured[0]

    def test_augment_prompt_includes_calibration(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"refined_titles": []})

        calibration = {"baseline_median_views": 5000, "samples": [], "mean_abs_error": None}
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_cap):
            from app.services.insights_gemini_service import augment_creator_idea
            augment_creator_idea("My rough idea here", {"channel_niche": "x"}, None, "creator", calibration=calibration)
        assert "CALIBRATION" in captured[0]

    def test_briefs_prompt_clean_without_calibration(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"briefs": []})

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_cap):
            from app.services.insights_gemini_service import generate_content_briefs
            generate_content_briefs({"channel_niche": "x"}, None, "creator")
        assert "CALIBRATION" not in captured[0]
