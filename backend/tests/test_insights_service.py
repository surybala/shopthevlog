"""
Tests for the insights pipeline services.

All external calls (Gemini API, YouTube API, PostgreSQL) are fully mocked.
Pattern mirrors test_kit_service.py — FakePgClient for DB, MagicMock for Gemini.
"""
import json
import pytest
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
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is not None
        assert result["channel_niche"] == "budget solo travel Asia"
        assert len(result["top_patterns"]) == 2

    def test_returns_none_on_gemini_failure(self):
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=Exception("API error")):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is None

    def test_returns_none_on_invalid_json(self):
        with patch("app.services.insights_gemini_service._call_gemini", return_value="not json"):
            from app.services.insights_gemini_service import analyze_content_patterns
            result = analyze_content_patterns(SAMPLE_VLOGS, "testcreator")
        assert result is None

    def test_sorts_top_bottom_by_view_count(self):
        captured_prompts = []

        def _capture(system, user_content, max_tokens):
            captured_prompts.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
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

        def _capture(system, user_content, max_tokens):
            captured_prompts.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
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
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import analyze_audience_demands
            result = analyze_audience_demands({"Japan Vlog": ["How much did it cost?", "Great video!"]})
        assert result is not None
        assert len(result["top_topics"]) == 2

    def test_handles_gemini_error_gracefully(self):
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=RuntimeError("timeout")):
            from app.services.insights_gemini_service import analyze_audience_demands
            result = analyze_audience_demands({"Japan Vlog": ["Great video!"]})
        assert result is None


class TestGenerateContentBriefs:
    def test_returns_empty_list_on_gemini_failure(self):
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=Exception("error")):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert result == []

    def test_returns_briefs_on_success(self):
        raw = json.dumps({"briefs": SAMPLE_BRIEFS})
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, SAMPLE_AUDIENCE, "testcreator")
        assert len(result) == 1
        assert result[0]["title"].startswith("I Traveled Japan")
        assert result[0]["estimated_score"] == 82

    def test_handles_non_list_briefs_field(self):
        raw = json.dumps({"briefs": "not a list"})
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert result == []

    def test_filters_non_dict_items(self):
        raw = json.dumps({"briefs": [SAMPLE_BRIEFS[0], "invalid", None, 42]})
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
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
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw) as mock_call:
            from app.services.insights_gemini_service import generate_content_briefs
            result = generate_content_briefs(SAMPLE_PATTERNS, None, "testcreator")
        assert len(result) == 1
        # Should mention no audience data in the prompt
        call_args = mock_call.call_args
        assert "No audience comment data" in call_args[0][1]


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
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "", "niche_label": ""}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="japan budget"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", return_value=[]),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=SAMPLE_AUDIENCE),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=SAMPLE_BRIEFS),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

    @pytest.mark.asyncio
    async def test_marks_failed_when_pattern_analysis_returns_none(self):
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        status_clients = [FakePgClient(rows=[]) for _ in range(5)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else status_clients[min(call_count[0] - 2, 4)]

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=SAMPLE_VLOGS),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "", "niche_label": ""}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value=""),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", return_value=[]),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
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


SAMPLE_PEERS = [
    {"channelId": "ch_1", "channelTitle": "BudgetTraveler", "subscriberCount": 120_000, "videoCount": 210, "viewCount": 30_000_000},
    {"channelId": "ch_2", "channelTitle": "TravelWithMike", "subscriberCount": 85_000, "videoCount": 140, "viewCount": 18_000_000},
]

SAMPLE_TRENDS_TASK = [
    {"topic": "Japan 7-day itineraries", "format": "day-by-day vlog", "momentum": "RISING", "score": 88, "evidence": "2 videos >50k views/day"},
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

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=SAMPLE_BENCHMARKS)

        assert len(captured) == 1
        assert "NICHE BENCHMARK VIDEOS" in captured[0]
        assert "BudgetTraveler" in captured[0]
        assert "2,400,000 views" in captured[0]

    def test_no_benchmark_section_when_benchmarks_is_none(self):
        captured = []

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=None)

        assert "NICHE BENCHMARK" not in captured[0]

    def test_no_benchmark_section_when_benchmarks_is_empty(self):
        captured = []

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "testcreator", benchmarks=[])

        assert "NICHE BENCHMARK" not in captured[0]


# ─── Benchmark stage in analyze_channel_task ──────────────────────────────────

class TestAnalyzeChannelTaskBenchmarking:
    @pytest.mark.asyncio
    async def test_fetches_benchmarks_using_gemini_niche_query(self):
        """The Gemini-derived niche query is preferred and drives the benchmark search."""
        vlogs = [
            {**SAMPLE_VLOGS[0], "viewCount": 5_000},
            {**SAMPLE_VLOGS[1], "viewCount": 3_000},
        ]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(12)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 11)]

        mock_benchmarks = MagicMock(return_value=SAMPLE_BENCHMARKS)
        mock_patterns = MagicMock(return_value=SAMPLE_PATTERNS)
        mock_keywords = MagicMock(return_value="fallback keywords")

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "japan budget itinerary", "niche_label": "budget japan"}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", mock_keywords),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_benchmarks),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=SAMPLE_PEERS),
            patch("app.tasks.analyze_channel.analyze_content_patterns", mock_patterns),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # Gemini query wins; deterministic keyword fallback is not consulted
        mock_keywords.assert_not_called()
        mock_benchmarks.assert_called_once_with("japan budget itinerary", max_results=15, recency_days=90)
        # Pattern analysis receives both benchmarks and peer channels
        _, kwargs = mock_patterns.call_args
        assert kwargs.get("benchmarks") == SAMPLE_BENCHMARKS
        assert kwargs.get("peers") == SAMPLE_PEERS

    @pytest.mark.asyncio
    async def test_falls_back_to_keyword_extraction_when_gemini_empty(self):
        """When Gemini returns no query, the deterministic keyword extractor is used."""
        vlogs = [{**SAMPLE_VLOGS[0], "viewCount": 5_000}]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(12)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 11)]

        mock_benchmarks = MagicMock(return_value=[])

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "", "niche_label": ""}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="japan budget"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_benchmarks),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        mock_benchmarks.assert_called_once_with("japan budget", max_results=15, recency_days=90)

    @pytest.mark.asyncio
    async def test_benchmarks_run_for_large_channel_too(self):
        """Established channels (many vlogs, high views) still get benchmark enrichment."""
        large_vlogs = [{**v, "viewCount": 200_000} for v in (SAMPLE_VLOGS * 3)[:10]]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(12)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 11)]

        mock_benchmarks = MagicMock(return_value=SAMPLE_BENCHMARKS)

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=large_vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "luxury europe travel", "niche_label": "luxury europe"}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="europe"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_benchmarks),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        mock_benchmarks.assert_called_once()

    @pytest.mark.asyncio
    async def test_persists_used_benchmarks_flag(self):
        """When benchmarks are used, _save_insight_results should record used_benchmarks=True."""
        vlogs = [{**SAMPLE_VLOGS[0], "viewCount": 2_000}]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        save_client = FakePgClient(rows=[])
        # Order of PgClient() calls after upsert: status→ANALYZING, subscriber-count read,
        # save_insight_results, (no briefs). save is the 3rd post-upsert client.
        pg_clients = [FakePgClient(rows=[]), FakePgClient(rows=[{"subscriberCount": 1000}]), save_client, FakePgClient(rows=[])]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 3)]

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "japan budget", "niche_label": "budget japan"}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value=None),
            patch("app.tasks.analyze_channel.extract_niche_keywords", return_value="japan budget"),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", return_value=SAMPLE_BENCHMARKS),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # The save query should include usedBenchmarks=True and benchmarkVideoCount=2
        all_params = [q[1] for q in save_client.cursor.queries]
        assert any(True in (p if isinstance(p, tuple) else ()) for p in all_params)

    @pytest.mark.asyncio
    async def test_uses_niche_cache_when_fresh(self):
        """A fresh per-niche benchmark cache is reused instead of hitting YouTube."""
        vlogs = [{**SAMPLE_VLOGS[0], "viewCount": 5_000}]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[]) for _ in range(12)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 11)]

        mock_search = MagicMock(return_value=[])
        mock_trends = MagicMock(return_value=SAMPLE_TRENDS_TASK)
        mock_patterns = MagicMock(return_value=SAMPLE_PATTERNS)

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "japan budget", "niche_label": "budget japan"}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value="niche-1"),
            patch("app.tasks.analyze_channel.load_cached_benchmarks", return_value={"videos": SAMPLE_BENCHMARKS, "peers": SAMPLE_PEERS}),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", mock_search),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=[]),
            patch("app.tasks.analyze_channel.compute_and_store_niche_trends", mock_trends),
            patch("app.tasks.analyze_channel.analyze_content_patterns", mock_patterns),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        # Cache hit → no live search, but benchmarks still flow into pattern analysis
        mock_search.assert_not_called()
        mock_trends.assert_called_once()
        _, kwargs = mock_patterns.call_args
        assert kwargs.get("benchmarks") == SAMPLE_BENCHMARKS
        assert kwargs.get("peers") == SAMPLE_PEERS

    @pytest.mark.asyncio
    async def test_saves_cache_and_trends_on_cache_miss(self):
        """On a cache miss we fetch live, persist the cache, and compute trends."""
        vlogs = [{**SAMPLE_VLOGS[0], "viewCount": 5_000}]
        upsert_client = FakePgClient(rows=[{"id": "insight-1"}])
        pg_clients = [FakePgClient(rows=[{"subscriberCount": 1000}]) for _ in range(12)]
        call_count = [0]

        def _pg_factory(*args, **kwargs):
            call_count[0] += 1
            return upsert_client if call_count[0] == 1 else pg_clients[min(call_count[0] - 2, 11)]

        mock_save = MagicMock()
        mock_trends = MagicMock(return_value=SAMPLE_TRENDS_TASK)

        with (
            patch("app.tasks.analyze_channel.PgClient", side_effect=_pg_factory),
            patch("app.tasks.analyze_channel.fetch_vlog_performance", return_value=vlogs),
            patch("app.tasks.analyze_channel.fetch_video_comments", return_value=[]),
            patch("app.tasks.analyze_channel.extract_niche_search_phrases", return_value={"query": "japan budget", "niche_label": "budget japan"}),
            patch("app.tasks.analyze_channel.classify_and_assign_niche", return_value="niche-1"),
            patch("app.tasks.analyze_channel.load_cached_benchmarks", return_value=None),
            patch("app.tasks.analyze_channel.search_niche_benchmarks", return_value=SAMPLE_BENCHMARKS),
            patch("app.tasks.analyze_channel.find_peer_channels", return_value=SAMPLE_PEERS),
            patch("app.tasks.analyze_channel.save_benchmark_cache", mock_save),
            patch("app.tasks.analyze_channel.compute_and_store_niche_trends", mock_trends),
            patch("app.tasks.analyze_channel.analyze_content_patterns", return_value=SAMPLE_PATTERNS),
            patch("app.tasks.analyze_channel.analyze_audience_demands", return_value=None),
            patch("app.tasks.analyze_channel.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.tasks.analyze_channel.generate_content_briefs", return_value=[]),
        ):
            from app.tasks.analyze_channel import analyze_channel_task
            await analyze_channel_task("creator-1", "testcreator")

        mock_save.assert_called_once()
        assert mock_save.call_args[0][0] == "niche-1"
        mock_trends.assert_called_once()


# ─── Phase 1: velocity, recency & peer intelligence ───────────────────────────

class TestViewVelocity:
    def test_returns_none_without_publish_date(self):
        from app.services.analytics_service import view_velocity
        assert view_velocity(1000, None) is None
        assert view_velocity(1000, "") is None

    def test_returns_none_for_unparseable_date(self):
        from app.services.analytics_service import view_velocity
        assert view_velocity(1000, "not-a-date") is None

    def test_computes_views_per_day(self):
        from datetime import datetime, timedelta, timezone
        from app.services.analytics_service import view_velocity
        ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        velocity = view_velocity(1000, ten_days_ago)
        # ~100 views/day; allow slack for elapsed test time
        assert 90 <= velocity <= 110

    def test_clamps_age_to_one_day_minimum(self):
        from datetime import datetime, timezone
        from app.services.analytics_service import view_velocity
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # A brand-new video should not divide by ~0
        velocity = view_velocity(5000, now)
        assert velocity is not None
        assert velocity <= 5000

    def test_handles_naive_datetime_string(self):
        from datetime import datetime, timedelta, timezone
        from app.services.analytics_service import view_velocity
        # A naive (no tz offset) timestamp must be treated as UTC, not rejected
        five_days_ago = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S")
        velocity = view_velocity(500, five_days_ago)
        assert velocity is not None
        assert velocity > 0


class TestRfc3339DaysAgo:
    def test_returns_z_suffixed_timestamp(self):
        from app.services.analytics_service import rfc3339_days_ago
        ts = rfc3339_days_ago(90)
        assert ts.endswith("Z")
        assert "T" in ts

    def test_is_in_the_past(self):
        from datetime import datetime, timezone
        from app.services.analytics_service import rfc3339_days_ago
        ts = rfc3339_days_ago(30)
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        assert parsed < datetime.now(timezone.utc)


class TestSearchNicheBenchmarksVelocity:
    def test_passes_published_after_when_recency_days_set(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        captured = {}

        class _Search:
            def list(self, **kwargs):
                captured.update(kwargs)
                m = MagicMock()
                m.execute.return_value = {"items": []}
                return m

        mock_yt = MagicMock()
        mock_yt.search.return_value = _Search()
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            search_niche_benchmarks("japan budget", recency_days=90)
        assert "publishedAfter" in captured

    def test_explicit_published_after_takes_precedence(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        captured = {}

        class _Search:
            def list(self, **kwargs):
                captured.update(kwargs)
                m = MagicMock()
                m.execute.return_value = {"items": []}
                return m

        mock_yt = MagicMock()
        mock_yt.search.return_value = _Search()
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            search_niche_benchmarks("japan", published_after="2024-01-01T00:00:00Z", recency_days=90)
        assert captured["publishedAfter"] == "2024-01-01T00:00:00Z"

    def test_no_published_after_by_default(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        captured = {}

        class _Search:
            def list(self, **kwargs):
                captured.update(kwargs)
                m = MagicMock()
                m.execute.return_value = {"items": []}
                return m

        mock_yt = MagicMock()
        mock_yt.search.return_value = _Search()
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            search_niche_benchmarks("japan")
        assert "publishedAfter" not in captured

    def test_ranks_by_velocity_when_dates_present(self, monkeypatch):
        from datetime import datetime, timedelta, timezone
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        old = (datetime.now(timezone.utc) - timedelta(days=2000)).strftime("%Y-%m-%dT%H:%M:%SZ")
        search_resp = {"items": [{"id": {"videoId": "fresh"}}, {"id": {"videoId": "stale"}}]}
        stats_resp = {
            "items": [
                {"id": "stale", "snippet": {"title": "Old megahit", "channelId": "c1", "channelTitle": "A", "publishedAt": old}, "statistics": {"viewCount": "5000000"}},
                {"id": "fresh", "snippet": {"title": "Rising star", "channelId": "c2", "channelTitle": "B", "publishedAt": recent}, "statistics": {"viewCount": "200000"}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.search.return_value.list.return_value.execute.return_value = search_resp
        mock_yt.videos.return_value.list.return_value.execute.return_value = stats_resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            result = search_niche_benchmarks("travel")
        # The fresh video (100k/day) outranks the old megahit (2.5k/day) despite fewer total views
        assert result[0]["videoId"] == "fresh"
        assert result[0]["viewVelocity"] > result[1]["viewVelocity"]

    def test_falls_back_to_viewcount_when_no_dates(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        search_resp = {"items": [{"id": {"videoId": "a"}}, {"id": {"videoId": "b"}}]}
        stats_resp = {
            "items": [
                {"id": "a", "snippet": {"title": "A", "channelId": "c1", "channelTitle": "A"}, "statistics": {"viewCount": "100"}},
                {"id": "b", "snippet": {"title": "B", "channelId": "c2", "channelTitle": "B"}, "statistics": {"viewCount": "900"}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.search.return_value.list.return_value.execute.return_value = search_resp
        mock_yt.videos.return_value.list.return_value.execute.return_value = stats_resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import search_niche_benchmarks
            result = search_niche_benchmarks("travel")
        assert result[0]["videoId"] == "b"
        assert result[0]["viewVelocity"] is None


class TestFindPeerChannels:
    def test_returns_empty_without_api_key(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "")
        from app.services.analytics_service import find_peer_channels
        assert find_peer_channels(["c1", "c2"]) == []

    def test_returns_empty_for_no_channel_ids(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        from app.services.analytics_service import find_peer_channels
        assert find_peer_channels([]) == []
        assert find_peer_channels(["", None]) == []

    def test_handles_api_error(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        mock_yt = MagicMock()
        mock_yt.channels.return_value.list.return_value.execute.side_effect = Exception("quota")
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import find_peer_channels
            assert find_peer_channels(["c1"]) == []

    def test_parses_and_sorts_by_subscribers(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        resp = {
            "items": [
                {"id": "c1", "snippet": {"title": "Small"}, "statistics": {"subscriberCount": "1000", "videoCount": "10", "viewCount": "5000"}},
                {"id": "c2", "snippet": {"title": "Big"}, "statistics": {"subscriberCount": "9000", "videoCount": "20", "viewCount": "9000"}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.channels.return_value.list.return_value.execute.return_value = resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import find_peer_channels
            result = find_peer_channels(["c1", "c2"])
        assert [p["channelTitle"] for p in result] == ["Big", "Small"]

    def test_filters_to_subscriber_band(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        resp = {
            "items": [
                {"id": "c1", "snippet": {"title": "TooSmall"}, "statistics": {"subscriberCount": "100"}},
                {"id": "c2", "snippet": {"title": "JustRight"}, "statistics": {"subscriberCount": "10000"}},
                {"id": "c3", "snippet": {"title": "TooBig"}, "statistics": {"subscriberCount": "5000000"}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.channels.return_value.list.return_value.execute.return_value = resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import find_peer_channels
            # creator has 10k subs; band 0.2x–5x → 2k..50k
            result = find_peer_channels(["c1", "c2", "c3"], creator_subscriber_count=10000)
        assert [p["channelTitle"] for p in result] == ["JustRight"]

    def test_band_fallback_when_filter_empties(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        resp = {
            "items": [
                {"id": "c1", "snippet": {"title": "Giant"}, "statistics": {"subscriberCount": "9000000"}},
            ]
        }
        mock_yt = MagicMock()
        mock_yt.channels.return_value.list.return_value.execute.return_value = resp
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import find_peer_channels
            result = find_peer_channels(["c1"], creator_subscriber_count=1000)
        # No peer fits the band, so we keep all resolved channels rather than nothing
        assert len(result) == 1

    def test_dedupes_channel_ids(self, monkeypatch):
        monkeypatch.setattr("app.services.analytics_service.settings.YOUTUBE_API_KEY", "fake-key")
        captured = {}

        class _Channels:
            def list(self, **kwargs):
                captured.update(kwargs)
                m = MagicMock()
                m.execute.return_value = {"items": []}
                return m

        mock_yt = MagicMock()
        mock_yt.channels.return_value = _Channels()
        with patch("app.services.analytics_service._youtube_client", mock_yt):
            from app.services.analytics_service import find_peer_channels
            find_peer_channels(["c1", "c1", "c2"])
        assert captured["id"] == "c1,c2"


class TestExtractNicheSearchPhrases:
    def test_returns_blank_for_no_titles(self):
        from app.services.insights_gemini_service import extract_niche_search_phrases
        assert extract_niche_search_phrases([]) == {"query": "", "niche_label": ""}
        assert extract_niche_search_phrases([{"title": None}]) == {"query": "", "niche_label": ""}

    def test_parses_query_and_label(self):
        raw = json.dumps({"query": "japan budget itinerary", "niche_label": "budget japan travel"})
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import extract_niche_search_phrases
            result = extract_niche_search_phrases(SAMPLE_VLOGS, "creator")
        assert result["query"] == "japan budget itinerary"
        assert result["niche_label"] == "budget japan travel"

    def test_returns_blank_on_gemini_error(self):
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=Exception("boom")):
            from app.services.insights_gemini_service import extract_niche_search_phrases
            result = extract_niche_search_phrases(SAMPLE_VLOGS, "creator")
        assert result == {"query": "", "niche_label": ""}

    def test_returns_blank_on_invalid_json(self):
        with patch("app.services.insights_gemini_service._call_gemini", return_value="not json"):
            from app.services.insights_gemini_service import extract_niche_search_phrases
            result = extract_niche_search_phrases(SAMPLE_VLOGS, "creator")
        assert result == {"query": "", "niche_label": ""}


class TestAnalyzeContentPatternsWithPeers:
    def test_includes_peer_section_when_provided(self):
        captured = []

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "creator", peers=SAMPLE_PEERS)
        assert "PEER CHANNELS" in captured[0]
        assert "BudgetTraveler" in captured[0]

    def test_no_peer_section_when_absent(self):
        captured = []

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "creator")
        assert "PEER CHANNELS" not in captured[0]

    def test_benchmark_velocity_rendered_in_prompt(self):
        captured = []
        benchmarks = [{**SAMPLE_BENCHMARKS[0], "viewVelocity": 12345.0}]

        def _capture(system, user_content, max_tokens):
            captured.append(user_content)
            return json.dumps(SAMPLE_PATTERNS)

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_capture):
            from app.services.insights_gemini_service import analyze_content_patterns
            analyze_content_patterns(SAMPLE_VLOGS, "creator", benchmarks=benchmarks)
        assert "views/day" in captured[0]


class TestFetchCreatorSubscriberCount:
    def test_returns_count_from_db(self):
        from app.tasks.analyze_channel import _fetch_creator_subscriber_count
        client = FakePgClient(rows=[{"subscriberCount": 4200}])
        with patch("app.tasks.analyze_channel.PgClient", return_value=client):
            assert _fetch_creator_subscriber_count("creator-1") == 4200

    def test_returns_zero_when_missing(self):
        from app.tasks.analyze_channel import _fetch_creator_subscriber_count
        client = FakePgClient(rows=[])
        with patch("app.tasks.analyze_channel.PgClient", return_value=client):
            assert _fetch_creator_subscriber_count("creator-1") == 0

    def test_returns_zero_on_db_error(self):
        from app.tasks.analyze_channel import _fetch_creator_subscriber_count
        with patch("app.tasks.analyze_channel.PgClient", side_effect=RuntimeError("db down")):
            assert _fetch_creator_subscriber_count("creator-1") == 0


# ─── augment_creator_idea (Phase 3 surface) ───────────────────────────────────

class TestAugmentCreatorIdea:
    def test_returns_parsed_dict_on_success(self):
        raw = json.dumps({"refined_titles": ["A"], "confidence_score": 72})
        with patch("app.services.insights_gemini_service._call_gemini", return_value=raw):
            from app.services.insights_gemini_service import augment_creator_idea
            result = augment_creator_idea("My rough idea about Japan", SAMPLE_PATTERNS, SAMPLE_AUDIENCE, "creator")
        assert result["confidence_score"] == 72

    def test_includes_top_vlogs_section(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"refined_titles": []})

        with patch("app.services.insights_gemini_service._call_gemini", side_effect=_cap):
            from app.services.insights_gemini_service import augment_creator_idea
            augment_creator_idea(
                "My rough idea", SAMPLE_PATTERNS, None, "creator",
                top_vlogs=[{"title": "Japan on a budget", "viewCount": 450000}],
            )
        assert "TOP PERFORMING VIDEOS" in captured[0]
        assert "Japan on a budget" in captured[0]

    def test_returns_empty_on_gemini_error(self):
        with patch("app.services.insights_gemini_service._call_gemini", side_effect=Exception("boom")):
            from app.services.insights_gemini_service import augment_creator_idea
            assert augment_creator_idea("idea text here", SAMPLE_PATTERNS, None, "creator") == {}

    def test_returns_empty_when_parse_not_dict(self):
        # valid JSON but a list, not an object → treated as failure
        with patch("app.services.insights_gemini_service._call_gemini", return_value="[]"):
            from app.services.insights_gemini_service import augment_creator_idea
            assert augment_creator_idea("idea text here", SAMPLE_PATTERNS, None, "creator") == {}


# ─── augment endpoint (Phase 4 live signals) ──────────────────────────────────

class TestAugmentEndpoint:
    def _override_user(self):
        from app.main import app
        from app.core.security import get_current_user, UserClaims
        app.dependency_overrides[get_current_user] = lambda: UserClaims(user_id="user-1", email="t@t.com")

    def test_returns_404_when_creator_missing(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self._override_user()
        with patch("app.api.v1.insights.PgClient", return_value=FakePgClient(rows=[])):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/augment", json={"idea": "a budget japan trip video"})
        app.dependency_overrides.clear()
        assert resp.status_code == 404

    def test_success_returns_live_signals(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self._override_user()

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "tc", "nicheId": "niche-1"}])
        insight_client = FakePgClient(rows=[{"topPatterns": json.dumps(SAMPLE_PATTERNS), "audienceDemands": json.dumps(SAMPLE_AUDIENCE)}])
        vlogs_client = FakePgClient(rows=[{"title": "Tokyo food tour", "viewCount": 1000}])
        persist_client = FakePgClient(rows=[{"id": "aug-1"}])
        clients = [creator_client, insight_client, vlogs_client, persist_client]
        calls = [0]

        def _factory(*a, **k):
            calls[0] += 1
            return clients[min(calls[0] - 1, len(clients) - 1)]

        augmentation = {
            "refined_titles": ["Better Title"],
            "hook_concepts": ["Hook"],
            "content_enhancements": [],
            "audience_connections": [],
            "niche_learnings": [],
            "overall_assessment": "Solid",
            "confidence_score": 71,
        }

        with (
            patch("app.api.v1.insights.PgClient", side_effect=_factory),
            patch("app.api.v1.insights.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.api.v1.insights.fetch_niche_trends", return_value=SAMPLE_TRENDS_TASK),
            patch("app.api.v1.insights.augment_creator_idea", return_value=augmentation) as mock_aug,
        ):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/augment", json={"idea": "a budget japan trip video"})

        app.dependency_overrides.clear()
        assert resp.status_code == 200
        data = resp.json()
        assert data["confidenceScore"] == 71
        assert "liveSignals" in data
        assert data["liveSignals"]["nicheTrends"][0]["topic"] == "Japan 7-day itineraries"
        # augment_creator_idea received the live niche trends + gap map
        _, kwargs = mock_aug.call_args
        assert kwargs.get("niche_trends") == SAMPLE_TRENDS_TASK
        assert isinstance(kwargs.get("gap_map"), list)

    def test_returns_503_when_augment_empty(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self._override_user()

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "tc", "nicheId": None}])
        insight_client = FakePgClient(rows=[])
        vlogs_client = FakePgClient(rows=[])
        clients = [creator_client, insight_client, vlogs_client]
        calls = [0]

        def _factory(*a, **k):
            calls[0] += 1
            return clients[min(calls[0] - 1, len(clients) - 1)]

        with (
            patch("app.api.v1.insights.PgClient", side_effect=_factory),
            patch("app.api.v1.insights.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.api.v1.insights.augment_creator_idea", return_value={}),
        ):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/augment", json={"idea": "a budget japan trip video"})

        app.dependency_overrides.clear()
        assert resp.status_code == 503

    def test_handles_malformed_insight_json(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self._override_user()

        creator_client = FakePgClient(rows=[{"id": "creator-1", "handle": "tc", "nicheId": None}])
        insight_client = FakePgClient(rows=[{"topPatterns": "not json", "audienceDemands": "not json"}])
        vlogs_client = FakePgClient(rows=[])
        persist_client = FakePgClient(rows=[{"id": "aug-1"}])
        clients = [creator_client, insight_client, vlogs_client, persist_client]
        calls = [0]

        def _factory(*a, **k):
            calls[0] += 1
            return clients[min(calls[0] - 1, len(clients) - 1)]

        with (
            patch("app.api.v1.insights.PgClient", side_effect=_factory),
            patch("app.api.v1.insights.fetch_calibration_context", return_value={"baseline_median_views": 0, "samples": [], "mean_abs_error": None}),
            patch("app.api.v1.insights.augment_creator_idea", return_value={"confidence_score": 50}),
        ):
            client = TestClient(app)
            resp = client.post("/api/v1/insights/augment", json={"idea": "a budget japan trip video"})

        app.dependency_overrides.clear()
        assert resp.status_code == 200
