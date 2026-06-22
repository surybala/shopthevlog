"""
Tests for the niche taxonomy / trend service (Phase 2).

All external calls (Gemini, PostgreSQL) are mocked. Mirrors test_insights_service.py.
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from tests.conftest import FakePgClient


SAMPLE_BENCHMARKS = [
    {"videoId": "b1", "title": "Japan 7-Day Itinerary", "channelId": "c1", "channelTitle": "A", "viewCount": 500_000, "viewVelocity": 80_000.0},
    {"videoId": "b2", "title": "Budget Hostels in Tokyo", "channelId": "c2", "channelTitle": "B", "viewCount": 200_000, "viewVelocity": 30_000.0},
]

SAMPLE_TRENDS = [
    {"topic": "Japan 7-day itineraries", "format": "day-by-day vlog", "momentum": "RISING", "score": 88, "evidence": "2 videos >50k views/day"},
    {"topic": "budget hostel tours", "format": "walkthrough", "momentum": "STEADY", "score": 60, "evidence": "steady demand"},
]


# ─── slugify ──────────────────────────────────────────────────────────────────

class TestSlugifyNiche:
    def test_basic_kebab_case(self):
        from app.services.niche_service import slugify_niche
        assert slugify_niche("Budget Backpacking Southeast Asia") == "budget-backpacking-southeast-asia"

    def test_strips_punctuation_and_edges(self):
        from app.services.niche_service import slugify_niche
        assert slugify_niche("  Luxury! Travel, Europe.  ") == "luxury-travel-europe"

    def test_empty_falls_back(self):
        from app.services.niche_service import slugify_niche
        assert slugify_niche("") == "general-travel"
        assert slugify_niche("!!!") == "general-travel"

    def test_truncates_long_labels(self):
        from app.services.niche_service import slugify_niche
        assert len(slugify_niche("word " * 40)) <= 80


# ─── classify_niche ───────────────────────────────────────────────────────────

class TestClassifyNiche:
    def test_returns_empty_for_no_titles(self):
        from app.services.niche_service import classify_niche
        assert classify_niche([], "creator", []) == {}

    def test_parses_classification(self):
        raw = json.dumps({"slug": "budget-japan", "label": "Budget Japan", "keywords": ["japan", "budget"]})
        with patch("app.services.niche_service._call_gemini", return_value=raw):
            from app.services.niche_service import classify_niche
            result = classify_niche([{"title": "Japan on a budget"}], "creator", [])
        assert result["slug"] == "budget-japan"

    def test_includes_existing_niches_in_prompt(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"slug": "x", "label": "X", "keywords": []})

        with patch("app.services.niche_service._call_gemini", side_effect=_cap):
            from app.services.niche_service import classify_niche
            classify_niche([{"title": "T"}], "creator", [{"slug": "budget-japan", "label": "Budget Japan"}])
        assert "budget-japan" in captured[0]

    def test_returns_empty_on_error(self):
        with patch("app.services.niche_service._call_gemini", side_effect=Exception("boom")):
            from app.services.niche_service import classify_niche
            assert classify_niche([{"title": "T"}], "creator", []) == {}

    def test_returns_empty_on_invalid_json(self):
        with patch("app.services.niche_service._call_gemini", return_value="not json"):
            from app.services.niche_service import classify_niche
            assert classify_niche([{"title": "T"}], "creator", []) == {}


# ─── DB helpers ───────────────────────────────────────────────────────────────

class TestNicheDbHelpers:
    def test_list_existing_niches(self):
        client = FakePgClient(rows=[{"id": "n1", "slug": "a", "label": "A"}])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import list_existing_niches
            result = list_existing_niches()
        assert result[0]["slug"] == "a"

    def test_get_or_create_niche_returns_id(self):
        client = FakePgClient(rows=[{"id": "niche-1"}])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import get_or_create_niche
            assert get_or_create_niche("budget-japan", "Budget Japan", ["japan"]) == "niche-1"

    def test_get_or_create_niche_blank_slug(self):
        from app.services.niche_service import get_or_create_niche
        assert get_or_create_niche("", "x", []) is None

    def test_assign_creator_niche_executes_update(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import assign_creator_niche
            assign_creator_niche("creator-1", "niche-1")
        assert any("UPDATE" in q[0] and "nicheId" in q[0] for q in client.cursor.queries)


class TestClassifyAndAssignNiche:
    def test_full_success_path(self):
        client = FakePgClient(rows=[{"id": "niche-1", "slug": "budget-japan", "label": "Budget Japan"}])
        with (
            patch("app.services.niche_service.PgClient", return_value=client),
            patch("app.services.niche_service.classify_niche", return_value={"slug": "budget-japan", "label": "Budget Japan", "keywords": ["japan"]}),
        ):
            from app.services.niche_service import classify_and_assign_niche
            result = classify_and_assign_niche("creator-1", "creator", [{"title": "Japan budget"}], "japan")
        assert result == "niche-1"

    def test_uses_hint_when_classify_empty(self):
        client = FakePgClient(rows=[{"id": "niche-2"}])
        with (
            patch("app.services.niche_service.PgClient", return_value=client),
            patch("app.services.niche_service.classify_niche", return_value={}),
        ):
            from app.services.niche_service import classify_and_assign_niche
            result = classify_and_assign_niche("creator-1", "creator", [{"title": "T"}], "luxury europe")
        assert result == "niche-2"
        # Should have inserted a niche derived from the hint
        assert any("INSERT INTO \"Niche\"" in q[0] for q in client.cursor.queries)

    def test_returns_none_on_exception(self):
        with patch("app.services.niche_service.list_existing_niches", side_effect=RuntimeError("db")):
            from app.services.niche_service import classify_and_assign_niche
            assert classify_and_assign_niche("creator-1", "creator", [{"title": "T"}], "x") is None


# ─── Benchmark cache ──────────────────────────────────────────────────────────

class TestBenchmarkCache:
    def test_load_returns_none_for_blank_niche(self):
        from app.services.niche_service import load_cached_benchmarks
        assert load_cached_benchmarks("") is None

    def test_load_returns_none_when_no_row(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import load_cached_benchmarks
            assert load_cached_benchmarks("niche-1") is None

    def test_load_returns_fresh_cache(self):
        future = datetime.now(timezone.utc) + timedelta(hours=5)
        client = FakePgClient(rows=[{
            "videosJson": json.dumps(SAMPLE_BENCHMARKS),
            "peersJson": json.dumps([{"channelId": "c1"}]),
            "expiresAt": future,
        }])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import load_cached_benchmarks
            result = load_cached_benchmarks("niche-1")
        assert result is not None
        assert len(result["videos"]) == 2
        assert result["peers"][0]["channelId"] == "c1"

    def test_load_returns_none_when_expired(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        client = FakePgClient(rows=[{
            "videosJson": json.dumps(SAMPLE_BENCHMARKS),
            "peersJson": json.dumps([]),
            "expiresAt": past,
        }])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import load_cached_benchmarks
            assert load_cached_benchmarks("niche-1") is None

    def test_load_handles_already_parsed_json(self):
        future = datetime.now(timezone.utc) + timedelta(hours=5)
        client = FakePgClient(rows=[{
            "videosJson": SAMPLE_BENCHMARKS,  # already a list
            "peersJson": [],
            "expiresAt": future.isoformat(),  # str form
        }])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import load_cached_benchmarks
            result = load_cached_benchmarks("niche-1")
        assert len(result["videos"]) == 2

    def test_load_returns_none_on_error(self):
        with patch("app.services.niche_service.PgClient", side_effect=RuntimeError("db")):
            from app.services.niche_service import load_cached_benchmarks
            assert load_cached_benchmarks("niche-1") is None

    def test_save_executes_upsert(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import save_benchmark_cache
            save_benchmark_cache("niche-1", "japan budget", SAMPLE_BENCHMARKS, [])
        assert any("NicheBenchmarkCache" in q[0] for q in client.cursor.queries)

    def test_save_noop_for_blank_niche(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import save_benchmark_cache
            save_benchmark_cache("", "q", [], [])
        assert client.cursor.queries == []

    def test_save_swallows_errors(self):
        with patch("app.services.niche_service.PgClient", side_effect=RuntimeError("db")):
            from app.services.niche_service import save_benchmark_cache
            # Must not raise
            save_benchmark_cache("niche-1", "q", [], [])


# ─── Niche trends ─────────────────────────────────────────────────────────────

class TestComputeNicheTrends:
    def test_empty_for_no_benchmarks(self):
        from app.services.niche_service import compute_niche_trends
        assert compute_niche_trends([]) == []

    def test_parses_trends(self):
        raw = json.dumps({"trends": SAMPLE_TRENDS})
        with patch("app.services.niche_service._call_gemini", return_value=raw):
            from app.services.niche_service import compute_niche_trends
            result = compute_niche_trends(SAMPLE_BENCHMARKS, "budget japan")
        assert len(result) == 2
        assert result[0]["topic"].startswith("Japan")

    def test_renders_velocity_in_prompt(self):
        captured = []

        def _cap(system, user, max_tokens):
            captured.append(user)
            return json.dumps({"trends": SAMPLE_TRENDS})

        with patch("app.services.niche_service._call_gemini", side_effect=_cap):
            from app.services.niche_service import compute_niche_trends
            compute_niche_trends(SAMPLE_BENCHMARKS, "budget japan")
        assert "views/day" in captured[0]

    def test_filters_non_dict_trends(self):
        raw = json.dumps({"trends": [SAMPLE_TRENDS[0], "bad", None]})
        with patch("app.services.niche_service._call_gemini", return_value=raw):
            from app.services.niche_service import compute_niche_trends
            assert len(compute_niche_trends(SAMPLE_BENCHMARKS)) == 1

    def test_empty_when_trends_not_list(self):
        raw = json.dumps({"trends": "nope"})
        with patch("app.services.niche_service._call_gemini", return_value=raw):
            from app.services.niche_service import compute_niche_trends
            assert compute_niche_trends(SAMPLE_BENCHMARKS) == []

    def test_empty_on_error(self):
        with patch("app.services.niche_service._call_gemini", side_effect=Exception("boom")):
            from app.services.niche_service import compute_niche_trends
            assert compute_niche_trends(SAMPLE_BENCHMARKS) == []


class TestStoreNicheTrends:
    def test_deletes_then_inserts(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import store_niche_trends
            store_niche_trends("niche-1", SAMPLE_TRENDS)
        sqls = [q[0] for q in client.cursor.queries]
        assert any("DELETE FROM \"NicheTrend\"" in s for s in sqls)
        assert sum("INSERT INTO \"NicheTrend\"" in s for s in sqls) == 2

    def test_skips_blank_topics(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import store_niche_trends
            store_niche_trends("niche-1", [{"topic": "  "}, {"topic": "Real"}])
        inserts = [q for q in client.cursor.queries if "INSERT INTO \"NicheTrend\"" in q[0]]
        assert len(inserts) == 1

    def test_normalises_bad_momentum(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import store_niche_trends
            store_niche_trends("niche-1", [{"topic": "X", "momentum": "explosive", "score": 5}])
        insert = [q for q in client.cursor.queries if "INSERT INTO \"NicheTrend\"" in q[0]][0]
        assert "STEADY" in insert[1]

    def test_noop_for_blank_niche(self):
        client = FakePgClient(rows=[])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import store_niche_trends
            store_niche_trends("", SAMPLE_TRENDS)
        assert client.cursor.queries == []

    def test_swallows_errors(self):
        with patch("app.services.niche_service.PgClient", side_effect=RuntimeError("db")):
            from app.services.niche_service import store_niche_trends
            store_niche_trends("niche-1", SAMPLE_TRENDS)


class TestComputeAndStoreNicheTrends:
    def test_computes_and_persists(self):
        client = FakePgClient(rows=[])
        with (
            patch("app.services.niche_service.PgClient", return_value=client),
            patch("app.services.niche_service.compute_niche_trends", return_value=SAMPLE_TRENDS),
        ):
            from app.services.niche_service import compute_and_store_niche_trends
            result = compute_and_store_niche_trends("niche-1", SAMPLE_BENCHMARKS, "budget japan")
        assert result == SAMPLE_TRENDS
        assert any("NicheTrend" in q[0] for q in client.cursor.queries)

    def test_skips_store_when_no_trends(self):
        client = FakePgClient(rows=[])
        with (
            patch("app.services.niche_service.PgClient", return_value=client),
            patch("app.services.niche_service.compute_niche_trends", return_value=[]),
        ):
            from app.services.niche_service import compute_and_store_niche_trends
            result = compute_and_store_niche_trends("niche-1", SAMPLE_BENCHMARKS)
        assert result == []
        assert client.cursor.queries == []


class TestFetchNicheTrends:
    def test_returns_rows(self):
        client = FakePgClient(rows=[{"topic": "Japan", "format": None, "momentum": "RISING", "score": 88, "evidence": None}])
        with patch("app.services.niche_service.PgClient", return_value=client):
            from app.services.niche_service import fetch_niche_trends
            result = fetch_niche_trends("niche-1")
        assert result[0]["topic"] == "Japan"

    def test_blank_niche_returns_empty(self):
        from app.services.niche_service import fetch_niche_trends
        assert fetch_niche_trends("") == []

    def test_returns_empty_on_error(self):
        with patch("app.services.niche_service.PgClient", side_effect=RuntimeError("db")):
            from app.services.niche_service import fetch_niche_trends
            assert fetch_niche_trends("niche-1") == []


class TestInternalHelpers:
    def test_loads_handles_bad_json(self):
        from app.services.niche_service import _loads
        assert _loads("not json") == []
        assert _loads(None) == []
        assert _loads([1, 2]) == [1, 2]

    def test_as_datetime_variants(self):
        from datetime import datetime, timezone
        from app.services.niche_service import _as_datetime
        assert _as_datetime(None) is None
        assert _as_datetime("garbage") is None
        naive = datetime(2026, 1, 1)
        assert _as_datetime(naive).tzinfo is not None
        aware = datetime(2026, 1, 1, tzinfo=timezone.utc)
        assert _as_datetime(aware) == aware
        assert _as_datetime("2026-01-01T00:00:00Z").year == 2026
