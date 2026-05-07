"""
Tests for the insights pipeline services.

All external calls (Gemini API, YouTube API, PostgreSQL) are fully mocked.
Pattern mirrors test_kit_service.py — FakePgClient for DB, MagicMock for Gemini.
"""
import json
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from tests.conftest import FakePgClient


# ─── Fixtures / helpers ───────────────────────────────────────────────────────

SAMPLE_VLOGS = [
    {"id": "v1", "externalId": "yt_abc", "title": "10 Days in Japan on a Budget", "viewCount": 450000, "likeCount": 12000, "transcript_excerpt": "We started in Tokyo..."},
    {"id": "v2", "externalId": "yt_def", "title": "Bali Travel Guide 2024", "viewCount": 280000, "likeCount": 8500, "transcript_excerpt": "Bali is incredible..."},
    {"id": "v3", "externalId": "yt_ghi", "title": "Q&A Answering Your Questions", "viewCount": 45000, "likeCount": 1200, "transcript_excerpt": "Hey guys welcome back..."},
    {"id": "v4", "externalId": "yt_jkl", "title": "What I Pack for 3 Months in Asia", "viewCount": 320000, "likeCount": 9800, "transcript_excerpt": "My packing list..."},
    {"id": "v5", "externalId": "yt_mno", "title": "Solo Female Travel Safety Tips", "viewCount": 190000, "likeCount": 6700, "transcript_excerpt": "Safety is key..."},
]

SAMPLE_PATTERNS = {
    "channel_niche": "budget solo travel Asia",
    "creator_archetype": "budget adventurer",
    "top_patterns": ["Destination-led titles drive 3x more views", "Packing content resonates strongly"],
    "weak_patterns": ["Q&A videos significantly underperform"],
    "content_strengths": ["Authentic budget breakdowns", "Southeast Asia expertise"],
    "content_gaps": ["Budget accommodation deep-dives", "Visa guides"],
    "recommended_formats": ["Day-by-day travel vlogs", "Packing list videos"],
}

SAMPLE_AUDIENCE = {
    "top_topics": [
        {"topic": "budget breakdown", "frequency": "high", "example_comment": "How much did you spend total?"},
        {"topic": "accommodation", "frequency": "high", "example_comment": "Where did you stay in Tokyo?"},
    ],
    "recurring_questions": ["What's your total budget?", "Is it safe for solo women?"],
    "emotional_triggers": ["Budget travel feels achievable", "Solo travel empowerment"],
    "underserved_needs": ["Detailed day-by-day cost breakdown"],
}

SAMPLE_BRIEFS = [
    {
        "title": "I Traveled Japan for 2 Weeks on $1,500 (Full Budget Breakdown)",
        "hook_ideas": ["Open with total spend reveal"],
        "content_outline": ["Day 1-3: Tokyo", "Day 4-7: Kyoto", "Full cost spreadsheet"],
        "trend_signal": "Japan travel demand up 40% YoY",
        "audience_signal": "87 comments asking for budget breakdown",
        "estimated_score": 82,
        "reasoning": "Budget breakdowns are your #1 comment request. Japan destination titles outperform by 3x.",
    }
]


def _make_gemini_response(text: str) -> MagicMock:
    mock = MagicMock()
    mock.text = text
    return mock


# ─── analytics_service tests ──────────────────────────────────────────────────

class TestFetchVlogPerformance:
    def test_returns_rows_from_db(self):
        client = FakePgClient(rows=SAMPLE_VLOGS)
        with patch("app.services.analytics_service.PgClient", return_value=client):
            from app.services.analytics_service import fetch_vlog_performance
            result = fetch_vlog_performance("creator-1", limit=10)
        assert len(result) == len(SAMPLE_VLOGS)
        assert result[0]["title"] == SAMPLE_VLOGS[0]["title"]

    def test_returns_empty_list_when_no_vlogs(self):
        client = FakePgClient(rows=[])
        with patch("app.services.analytics_service.PgClient", return_value=client):
            from app.services.analytics_service import fetch_vlog_performance
            result = fetch_vlog_performance("creator-1")
        assert result == []

    def test_youtube_client_lazy_init(self, monkeypatch):
        import sys
        import app.services.analytics_service as svc
        monkeypatch.setattr(svc, "_youtube_client", None)
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        mock_built = MagicMock()
        mock_build_fn = MagicMock(return_value=mock_built)
        mock_discovery = MagicMock()
        mock_discovery.build = mock_build_fn
        monkeypatch.setitem(sys.modules, "googleapiclient.discovery", mock_discovery)
        result = svc._youtube()
        mock_build_fn.assert_called_once_with(
            "youtube", "v3", developerKey="fake-key", cache_discovery=False
        )
        assert result is mock_built
        monkeypatch.setattr(svc, "_youtube_client", None)

    def test_fetch_video_comments_returns_empty_without_api_key(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "")
        from app.services.analytics_service import fetch_video_comments
        result = fetch_video_comments("yt_abc")
        assert result == []

    def test_fetch_video_comments_handles_api_error_gracefully(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        mock_yt = MagicMock()
        mock_yt.commentThreads.return_value.list.return_value.execute.side_effect = Exception("403 disabled")
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import fetch_video_comments
            result = fetch_video_comments("yt_abc")
        assert result == []

    def test_fetch_video_comments_parses_response(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        mock_resp = {
            "items": [
                {"snippet": {"topLevelComment": {"snippet": {"textDisplay": "Great video!"}}}},
                {"snippet": {"topLevelComment": {"snippet": {"textDisplay": "Where did you stay?"}}}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.commentThreads.return_value.list.return_value.execute.return_value = mock_resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import fetch_video_comments
            result = fetch_video_comments("yt_abc")
        assert result == ["Great video!", "Where did you stay?"]


# ─── insights_gemini_service tests ────────────────────────────────────────────

class TestAnalyzeContentPatterns:
    def test_returns_none_for_empty_vlogs(self):
        from app.services.insights_gemini_service import analyze_content_patterns
        assert analyze_content_patterns([], "creator") is None

    def test_returns_parsed_patterns_on_success(self):
        raw = json.dumps(SAMPLE_PATTERNS)
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is not None
        assert result["channel_niche"] == "budget solo travel Asia"
        assert len(result["top_patterns"]) == 2

    def test_returns_none_on_gemini_failure(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=Exception("API error")):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is None

    def test_returns_none_on_invalid_json(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value="not json"):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is None

    def test_sorts_top_bottom_by_view_count(self):
        captured_prompts = []

        def _capture(prompt_key, system, user_content, max_tokens):
            captured_prompts.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator")

        assert len(captured_prompts) == 1
        # highest-view video should appear in the sorted videos section
        assert "Japan" in captured_prompts[0]
        assert "CREATOR'S VIDEOS" in captured_prompts[0]

    def test_zero_view_data_adds_note_to_prompt(self):
        zero_view_vlogs = [
            {"title": "Bali Trip Vlog", "viewCount": 0, "transcript_excerpt": "..."},
            {"title": "Tokyo Food Guide", "viewCount": 0, "transcript_excerpt": "..."},
        ]
        captured_prompts = []

        def _capture(prompt_key, system, user_content, max_tokens):
            captured_prompts.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(zero_view_vlogs, "testcreator")

        assert "View count data is unavailable" in captured_prompts[0]


class TestAnalyzeAudienceDemands:
    def test_returns_none_for_empty_input(self):
        from app.services.insights_gemini_service import analyze_audience_demands
        assert analyze_audience_demands({}) is None

    def test_returns_none_when_all_comment_lists_empty(self):
        from app.services.insights_gemini_service import analyze_audience_demands
        assert analyze_audience_demands({"Video 1": [], "Video 2": []}) is None

    def test_returns_parsed_audience_on_success(self):
        raw = json.dumps(SAMPLE_AUDIENCE)
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw):
            from app.services.insights_gemini_service import analyze_audience_demands
            result = analyze_audience_demands({"Japan Vlog": ["How much did it cost?", "Great video!"]})
        assert result is not None
        assert len(result["top_topics"]) == 2

    def test_handles_gemini_error_gracefully(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=RuntimeError("timeout")):
            from app.services.insights_gemini_service import analyze_audience_demands
            result = analyze_audience_demands({"Japan Vlog": ["Great video!"]})
        assert result is None


class TestGenerateContentBriefs:
    def test_returns_empty_list_on_gemini_failure(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=Exception("error")):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert result == []

    def test_returns_briefs_on_success(self):
        raw = json.dumps({"briefs": SAMPLE_BRIEFS})
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, SAMPLE_AUDIENCE, "testcreator")
        assert len(result) == 1
        assert result[0]["title"].startswith("I Traveled Japan")
        assert result[0]["estimated_score"] == 82

    def test_handles_non_list_briefs_field(self):
        raw = json.dumps({"briefs": "not a list"})
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert result == []

    def test_filters_non_dict_items(self):
        raw = json.dumps({"briefs": [SAMPLE_BRIEFS[0], "invalid", None, 42]})
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert len(result) == 1

    def test_returns_empty_when_parse_response_returns_none(self):
        with (
            patch("app.services.insights_gemini_service._call_gemini", return_value="{}"),
            patch("app.services.insights_gemini_service._parse_response", return_value=None),
        ):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert result == []

    def test_works_without_audience_data(self):
        raw = json.dumps({"briefs": SAMPLE_BRIEFS})
        with patch("app.services.insights_gemini_service._call_gemini_cached", return_value=raw) as mock_call:
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert len(result) == 1
        # Should mention no audience data in the prompt (user_content is arg index 2 after prompt_key, system)
        call_args = mock_call.call_args
        assert "No audience comment data" in call_args[0][2]


# ─── analyze_channel_task tests ───────────────────────────────────────────────

class TestAnalyzeChannelTask:
    @pytest.mark.asyncio
    async def test_fails_gracefully_when_no_vlogs(self):
        client = FakePgClient(rows=[{"id": "insight-1"}])

        def _pg_factory(*args, **kwargs):
            return client

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            # Should not raise
            await analyze_channel_task("creator-1", "testcreator")

        queries = client.cursor.queries
        # Should have attempted upsert + status update to ANALYZING + FAILED
        sql_texts = [q[0] for q in queries]
        assert any("ChannelInsight" in s for s in sql_texts)

    @pytest.mark.asyncio
    async def test_full_pipeline_success(self):
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        status_client = FakePgClient(rows=[])
        save_client = FakePgClient(rows=[])
        briefs_client = FakePgClient(rows=[])

        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return upsert_client
            if call_count[0] == 2:
                return status_client
            if call_count[0] == 3:
                return save_client
            return briefs_client

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=SAMPLE_VLOGS),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=["Great video!"]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=SAMPLE_AUDIENCE),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=SAMPLE_BRIEFS),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

    @pytest.mark.asyncio
    async def test_marks_failed_when_pattern_analysis_returns_none(self):
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        status_clients = [FakePgClient(rows=[]) for _ in range(3)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else status_clients[min(call_count[0] - 2, 2)]

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=SAMPLE_VLOGS),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=None),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # At least one of the status clients should have received a FAILED update
        all_queries = []
        for sc in status_clients:
            all_queries.extend(sc.cursor.queries)
        assert any("FAILED" in str(q) for q in all_queries)

    @pytest.mark.asyncio
    async def test_status_update_failure_does_not_propagate(self):
        """The nested except in the error handler must swallow failures silently."""
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return upsert_client
            raise RuntimeError("DB unavailable")

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", side_effect=ValueError("boom")),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            # Must not raise even when _update_insight_status itself fails
            await analyze_channel_task("creator-1", "testcreator")

    @pytest.mark.asyncio
    async def test_marks_failed_on_unexpected_exception(self):
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        failed_client = FakePgClient(rows=[])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else failed_client

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", side_effect=RuntimeError("DB exploded")),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # Should have set status to FAILED via the final except block
        sql_texts = [q[0] for q in failed_client.cursor.queries]
        assert any("FAILED" in str(q) for q in failed_client.cursor.queries)


# ─── insights API endpoint tests ──────────────────────────────────────────────

class TestInsightsAPI:
    def test_trigger_returns_404_when_creator_not_found(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        empty_client = FakePgClient(rows=[])

        with patch("app.api.v1.insights.PgClient", return_value=empty_client):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 404
        assert "Creator not found" in resp.json()["detail"]

    def test_get_returns_404_when_creator_not_found(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        empty_client = FakePgClient(rows=[])

        with patch("app.api.v1.insights.PgClient", return_value=empty_client):
            client = TestClient(app)
            resp = client.get("/api/v1/insights")

        app.dependency_overrides.clear()
        assert resp.status_code == 404
        assert "Creator not found" in resp.json()["detail"]

    def test_trigger_returns_queued(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        insight_client = FakePgClient(rows=[])

        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            with patch("app.api.v1.insights.analyze_channel_task") as mock_task:
                client = TestClient(app)
                resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_trigger_returns_analyzing_when_already_running(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        insight_client = FakePgClient(rows=[{"status": "ANALYZING"}])

        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["status"] == "ANALYZING"

    def test_get_insights_returns_none_when_no_data(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        creator_client = FakePgClient(rows=[{"id": "creator-1"}])
        insight_client = FakePgClient(rows=[])

        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            client = TestClient(app)
            resp = client.get("/api/v1/insights")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        data = resp.json()
        assert data["insight"] is None
        assert data["briefs"] == []

    def test_get_insights_returns_insight_and_briefs(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        creator_client = FakePgClient(rows=[{"id": "creator-1"}])
        insight_row = {
            "id": "insight-1",
            "status": "COMPLETE",
            "channelNiche": "budget travel Asia",
            "topPatterns": json.dumps(SAMPLE_PATTERNS),
            "audienceDemands": None,
            "analyzedVideoCount": 5,
            "analyzedAt": None,
            "updatedAt": None,
        }
        insight_client = FakePgClient(rows=[insight_row])
        briefs_client = FakePgClient(rows=[{
            "id": "brief-1",
            "title": "Japan on $1500",
            "hookIdeas": json.dumps(["Open with total spend"]),
            "contentOutline": json.dumps(["Day 1", "Day 2"]),
            "trendSignal": None,
            "audienceSignal": None,
            "estimatedScore": 80,
            "reasoning": "Budget breakdowns perform well.",
            "createdAt": None,
        }])

        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return creator_client
            if call_count[0] == 2:
                return insight_client
            return briefs_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            client = TestClient(app)
            resp = client.get("/api/v1/insights")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        data = resp.json()
        assert data["insight"]["status"] == "COMPLETE"
        assert data["insight"]["channelNiche"] == "budget travel Asia"
        assert len(data["briefs"]) == 1
        assert data["briefs"][0]["estimatedScore"] == 80


# ─── extract_niche_keywords tests ─────────────────────────────────────────────

class TestExtractNicheKeywords:
    def test_returns_empty_string_for_empty_vlogs(self):
        from app.services.analytics_service import extract_niche_keywords
        assert extract_niche_keywords([]) == ""

    def test_returns_empty_string_for_vlogs_with_no_titles(self):
        from app.services.analytics_service import extract_niche_keywords
        assert extract_niche_keywords([{"title": None}, {"title": ""}]) == ""

    def test_extracts_top_terms_from_titles(self):
        from app.services.analytics_service import extract_niche_keywords
        vlogs = [
            {"title": "10 Days in Japan on a Budget"},
            {"title": "Japan Budget Itinerary 2024"},
            {"title": "Solo Japan on $50 per day"},
        ]
        result = extract_niche_keywords(vlogs)
        # "japan" and "budget" appear most frequently and are not stop words
        assert "japan" in result
        assert "budget" in result

    def test_filters_stop_words(self):
        from app.services.analytics_service import extract_niche_keywords
        vlogs = [{"title": "the best travel tips for a great day"}]
        result = extract_niche_keywords(vlogs)
        # "the", "best", "for", "a", "great", "day" are all stop words / short
        assert "the" not in result
        assert "for" not in result

    def test_returns_at_most_five_terms(self):
        from app.services.analytics_service import extract_niche_keywords
        vlogs = [{"title": "alpha beta gamma delta epsilon zeta"} for _ in range(5)]
        terms = extract_niche_keywords(vlogs).split()
        assert len(terms) <= 5

    def test_ignores_short_tokens(self):
        from app.services.analytics_service import extract_niche_keywords
        vlogs = [{"title": "UK vs US trip"}]
        result = extract_niche_keywords(vlogs)
        # "UK", "US" are 2 chars — filtered by len(t) > 2
        assert "uk" not in result
        assert "us" not in result


# ─── search_niche_benchmarks tests ────────────────────────────────────────────

SAMPLE_BENCHMARKS = [
    {
        "videoId": "yt_bench1",
        "title": "I Spent 30 Days in Japan on $1,500",
        "channelTitle": "BudgetTraveler",
        "description": "Full budget breakdown including accommodation and food.",
        "viewCount": 2_400_000,
        "likeCount": 48_000,
    },
    {
        "videoId": "yt_bench2",
        "title": "Bali on a Budget — Complete Guide",
        "channelTitle": "TravelWithMike",
        "description": "Everything you need to know for a budget Bali trip.",
        "viewCount": 1_800_000,
        "likeCount": 36_000,
    },
]


class TestSearchNicheBenchmarks:
    def test_returns_empty_without_api_key(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "")
        from app.services.analytics_service import search_niche_benchmarks
        assert search_niche_benchmarks("japan budget travel") == []

    def test_returns_empty_for_blank_query(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        from app.services.analytics_service import search_niche_benchmarks
        assert search_niche_benchmarks("") == []

    def test_returns_empty_on_api_error(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        mock_yt = MagicMock()
        mock_yt.search.return_value.list.return_value.execute.side_effect = Exception("403 quota")
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            result = search_niche_benchmarks("japan budget travel")
        assert result == []

    def test_parses_search_and_stats_response(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        search_resp = {"items": [{"id": {"videoId": "yt_bench1"}}, {"id": {"videoId": "yt_bench2"}}]}
        stats_resp = {
            "items": [
                {
                    "id": "yt_bench1",
                    "snippet": {"title": "Japan on $1500", "channelTitle": "BudgetTravel", "description": "Full breakdown"},
                    "statistics": {"viewCount": "2400000", "likeCount": "48000"},
                },
                {
                    "id": "yt_bench2",
                    "snippet": {"title": "Bali Budget Guide", "channelTitle": "TravelMike", "description": "Bali tips"},
                    "statistics": {"viewCount": "1800000", "likeCount": "36000"},
                },
            ]
        }
        mock_yt = MagicMock()
        mock_yt.search.return_value.list.return_value.execute.return_value = search_resp
        mock_yt.videos.return_value.list.return_value.execute.return_value = stats_resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            result = search_niche_benchmarks("japan budget travel", max_results=10)
        assert len(result) == 2
        assert result[0]["videoId"] == "yt_bench1"
        assert result[0]["viewCount"] == 2_400_000
        assert result[0]["title"] == "Japan on $1500"
        # Sorted descending by view count
        assert result[0]["viewCount"] >= result[1]["viewCount"]

    def test_skips_items_without_video_id(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        search_resp = {"items": [{"id": {"kind": "youtube#channel"}}]}
        mock_yt = MagicMock()
        mock_yt.search.return_value.list.return_value.execute.return_value = search_resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            result = search_niche_benchmarks("japan budget travel")
        assert result == []


# ─── Benchmark enrichment in analyze_content_patterns ─────────────────────────

class TestAnalyzeContentPatternsWithBenchmarks:
    def test_includes_benchmark_section_in_prompt_when_provided(self):
        captured = []

        def _capture(prompt_key, system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=SAMPLE_BENCHMARKS)

        assert len(captured) == 1
        assert "NICHE BENCHMARK VIDEOS" in captured[0]
        assert "BudgetTraveler" in captured[0]
        assert "2,400,000 views" in captured[0]

    def test_no_benchmark_section_when_benchmarks_is_none(self):
        captured = []

        def _capture(prompt_key, system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=None)

        assert "NICHE BENCHMARK" not in captured[0]

    def test_no_benchmark_section_when_benchmarks_is_empty(self):
        captured = []

        def _capture(prompt_key, system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini_cached", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=[])

        assert "NICHE BENCHMARK" not in captured[0]


# ─── Benchmark stage in analyze_channel_task ──────────────────────────────────

class TestAnalyzeChannelTaskBenchmarking:
    @pytest.mark.asyncio
    async def test_fetches_benchmarks_for_small_channel(self):
        """A channel with < 10 vlogs and low views should trigger benchmark fetch."""
        small_vlogs = [
            {**SAMPLE_VLOGS[0], "viewCount": 5_000},
            {**SAMPLE_VLOGS[1], "viewCount": 3_000},
        ]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(10)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 9)]

        mock_benchmarks = MagicMock(return_value=SAMPLE_BENCHMARKS)
        mock_patterns = MagicMock(return_value=SAMPLE_PATTERNS)

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=small_vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="japan budget"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_benchmarks),
            patch("app.tasks.analyze_channel.analyze_content_patterns", mock_patterns),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        mock_benchmarks.assert_called_once_with("japan budget", max_results=15)
        # Pattern analysis should have received the benchmarks
        _, kwargs = mock_patterns.call_args
        assert kwargs.get("benchmarks") == SAMPLE_BENCHMARKS

    @pytest.mark.asyncio
    async def test_skips_benchmarks_for_large_channel(self):
        """A channel with >= 10 vlogs and high views should not trigger benchmarking."""
        large_vlogs = [{**v, "viewCount": 200_000} for v in (SAMPLE_VLOGS * 3)[:10]]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(10)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 9)]

        mock_benchmarks = MagicMock(return_value=[])

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=large_vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_benchmarks),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        mock_benchmarks.assert_not_called()

    @pytest.mark.asyncio
    async def test_persists_used_benchmarks_flag(self):
        """When benchmarks are used, _save_insight_results should record used_benchmarks=True."""
        small_vlogs = [{**SAMPLE_VLOGS[0], "viewCount": 2_000}]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        save_client = FakePgClient(rows=[])
        pg_clients = [FakePgClient(rows=[]), save_client, FakePgClient(rows=[])]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 2)]

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=small_vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="japan budget"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", return_value=SAMPLE_BENCHMARKS),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # The save query should include usedBenchmarks=True and benchmarkVideoCount=2
        all_params = [q[1] for q in save_client.cursor.queries]
        assert any(True in (p if isinstance(p, tuple) else ()) for p in all_params)


# ─── Insights TTL cache tests ─────────────────────────────────────────────────

class TestInsightsTTLCache:
    def test_returns_cached_when_analyzed_recently(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        recent_ts = datetime.now(timezone.utc) - timedelta(hours=1)
        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        insight_client = FakePgClient(rows=[{"status": "COMPLETE", "analyzedAt": recent_ts}])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            with patch("app.api.v1.insights.analyze_channel_task") as mock_task:
                client = TestClient(app)
                resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "CACHED"
        assert "cached_at" in data
        assert "Next refresh" in data["message"]
        mock_task.assert_not_called()

    def test_queues_when_analyzed_beyond_ttl(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        stale_ts = datetime.now(timezone.utc) - timedelta(hours=8)
        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        insight_client = FakePgClient(rows=[{"status": "COMPLETE", "analyzedAt": stale_ts}])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            with patch("app.api.v1.insights.analyze_channel_task"):
                client = TestClient(app)
                resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_queues_when_previous_run_failed(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        # FAILED status should never be treated as cached
        insight_client = FakePgClient(rows=[{"status": "FAILED", "analyzedAt": None}])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            with patch("app.api.v1.insights.analyze_channel_task"):
                client = TestClient(app)
                resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_cached_when_analyzed_at_is_iso_string(self):
        """analyzedAt may arrive as an ISO string from some DB adapters."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.security import get_current_user, UserClaims

        mock_user = UserClaims(user_id="user-1", email="test@test.com")
        app.dependency_overrides[get_current_user] = lambda: mock_user

        recent_iso = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "testcreator"}])
        insight_client = FakePgClient(rows=[{"status": "COMPLETE", "analyzedAt": recent_iso}])
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return creator_client if call_count[0] == 1 else insight_client

        with patch("app.api.v1.insights.PgClient", side_effect=_pg_factory):
            with patch("app.api.v1.insights.analyze_channel_task") as mock_task:
                client = TestClient(app)
                resp = client.post("/api/v1/insights/analyze")

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["status"] == "CACHED"
        mock_task.assert_not_called()


# ─── Gemini context cache tests ───────────────────────────────────────────────

class TestGeminiContextCache:
    def setup_method(self):
        import app.services.gemini_service as svc
        svc._prompt_caches.clear()

    def test_creates_cache_on_first_call(self):
        import app.services.gemini_service as svc

        mock_cache = MagicMock()
        mock_cache.name = "cachedContents/abc123"
        mock_response = MagicMock()
        mock_response.text = '{"result": "ok"}'

        mock_client = MagicMock()
        mock_client.caches.create.return_value = mock_cache
        mock_client.models.generate_content.return_value = mock_response

        with patch("app.services.gemini_service._gemini_client", mock_client):
            result = svc._call_gemini_cached("test-key", "System prompt", "User content", 1024)

        assert result == '{"result": "ok"}'
        mock_client.caches.create.assert_called_once()
        assert svc._prompt_caches["test-key"] == "cachedContents/abc123"

    def test_reuses_existing_cache_on_second_call(self):
        import app.services.gemini_service as svc

        svc._prompt_caches["test-key"] = "cachedContents/existing"
        mock_response = MagicMock()
        mock_response.text = '{"result": "reused"}'

        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        with patch("app.services.gemini_service._gemini_client", mock_client):
            result = svc._call_gemini_cached("test-key", "System prompt", "User content", 1024)

        assert result == '{"result": "reused"}'
        mock_client.caches.create.assert_not_called()

    def test_falls_back_to_uncached_when_cache_creation_fails(self):
        import app.services.gemini_service as svc

        mock_response = MagicMock()
        mock_response.text = '{"result": "fallback"}'

        mock_client = MagicMock()
        mock_client.caches.create.side_effect = Exception("below minimum token threshold")
        mock_client.models.generate_content.return_value = mock_response

        with patch("app.services.gemini_service._gemini_client", mock_client):
            result = svc._call_gemini_cached("test-key", "System prompt", "User content", 1024)

        assert result == '{"result": "fallback"}'
        assert "test-key" not in svc._prompt_caches
        # Falls back to _call_gemini which also uses generate_content
        mock_client.models.generate_content.assert_called_once()

    def test_clears_cache_and_retries_on_stale_cache_error(self):
        import app.services.gemini_service as svc

        svc._prompt_caches["test-key"] = "cachedContents/stale"

        fresh_response = MagicMock()
        fresh_response.text = '{"result": "fresh"}'

        mock_client = MagicMock()
        # First call (cached) raises, second (fallback) succeeds
        mock_client.models.generate_content.side_effect = [
            Exception("cache not found"),
            fresh_response,
        ]

        with patch("app.services.gemini_service._gemini_client", mock_client):
            result = svc._call_gemini_cached("test-key", "System prompt", "User content", 1024)

        assert result == '{"result": "fresh"}'
        assert "test-key" not in svc._prompt_caches

    def test_insights_service_uses_cached_calls(self):
        """All three analysis functions should route through _call_gemini_cached."""
        with patch("app.services.insights_gemini_service._call_gemini_cached") as mock_cached:
            mock_cached.return_value = json.dumps(SAMPLE_PATTERNS)
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator")

        mock_cached.assert_called_once()
        call_args = mock_cached.call_args
        assert call_args[0][0] == "content-patterns"

    def test_audience_demands_uses_cached_calls(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached") as mock_cached:
            mock_cached.return_value = json.dumps(SAMPLE_AUDIENCE)
            from app.services.insights_gemini_service import analyze_audience_demands
            analyze_audience_demands({"Japan Vlog": ["Great video!"]})

        mock_cached.assert_called_once()
        assert mock_cached.call_args[0][0] == "audience-demands"

    def test_content_briefs_uses_cached_calls(self):
        with patch("app.services.insights_gemini_service._call_gemini_cached") as mock_cached:
            mock_cached.return_value = json.dumps({"briefs": SAMPLE_BRIEFS})
            from app.services.insights_gemini_service import generate_content_briefs
            generate_content_briefs(SAMPLE_PATTERNS, SAMPLE_AUDIENCE, "testcreator")

        mock_cached.assert_called_once()
        assert mock_cached.call_args[0][0] == "content-briefs"
