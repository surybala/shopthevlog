"""
Tests for the shoppability guard added to app.services.gemini_service.

Specifically:
  - generate_trip_kit() skips kit creation and marks vlog COMPLETE when
    Gemini returns {"skip": true} or {"not_travel": true}
  - Both primary and compact prompts enforce the guard
  - Real travel content with named places still generates a kit

All external calls (Gemini API, PostgreSQL) are fully mocked.
"""
import sys
import json
import pytest
from unittest.mock import MagicMock, patch, call

from tests.conftest import FakePgClient

# ── Stub out google.genai so the module can be imported without the SDK ───────
# Running in isolation (without the full suite) requires explicit stubbing
# because google-genai may not be installed in the test environment.
_genai_stub = MagicMock()
sys.modules.setdefault("google", MagicMock())
sys.modules.setdefault("google.genai", _genai_stub)
sys.modules.setdefault("google.genai.types", MagicMock())

# Also stub other deps that gemini_service.py imports at module level
sys.modules.setdefault("psycopg2", MagicMock())
sys.modules.setdefault("psycopg2.extras", MagicMock())

# Force-import the module so patch("app.services.gemini_service.*") can resolve
import importlib
import app.services
_gs = importlib.import_module("app.services.gemini_service")
app.services.gemini_service = _gs  # make it an attribute of the package


# ─── Helpers ─────────────────────────────────────────────────────────────────

VALID_ITINERARY = {
    "title": "3 Days in Paris",
    "summary": "A wonderful trip to the City of Light.",
    "total_days": 3,
    "destinations": ["Paris"],
    "countries": ["France"],
    "primary_city": "Paris",
    "estimated_budget_usd": 1500,
    "days": [
        {
            "day_number": 1,
            "city": "Paris",
            "country": "France",
            "title": "Arrival & Eiffel Tower",
            "summary": "Arrive and visit the Eiffel Tower.",
            "activities": [
                {
                    "sort_order": 0,
                    "type": "ATTRACTION",
                    "title": "Eiffel Tower",
                    "description": "Iconic iron lattice tower on the Champ de Mars.",
                    "time": "15:00",
                    "latitude": 48.8584,
                    "longitude": 2.2945,
                    "image_url": None,
                },
                {
                    "sort_order": 1,
                    "type": "FOOD",
                    "title": "Café de Flore",
                    "description": "Historic café in Saint-Germain-des-Prés.",
                    "time": "18:00",
                    "latitude": 48.8542,
                    "longitude": 2.3328,
                    "image_url": None,
                },
            ],
        }
    ],
}


def _gemini_response(text: str) -> MagicMock:
    m = MagicMock()
    m.text = text
    return m


def _no_existing_kit_pg():
    """First DB call (check for existing kit) returns no row."""
    return FakePgClient(rows=[])


def _pg_sequence(*row_lists):
    """Return a list of FakePgClient instances for sequential calls."""
    return [FakePgClient(list(rows)) for rows in row_lists]


# ─────────────────────────────────────────────────────────────────────────────
# Shoppability guard — {"skip": true}
# ─────────────────────────────────────────────────────────────────────────────

class TestSkipFlag:

    def _run(self, gemini_text: str):
        """Run generate_trip_kit with a fixed Gemini response."""
        clients = iter([_no_existing_kit_pg(), FakePgClient()])
        mock_response = _gemini_response(gemini_text)

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = mock_response
            from app.services.gemini_service import generate_trip_kit
            return generate_trip_kit(
                vlog_id="vlog-001",
                transcript="Today I juggled 5 balls for 3 minutes.",
                title="Juggling tutorial",
                creator_id="creator-1",
            )

    def test_returns_false_when_skip_is_true(self):
        result = self._run(json.dumps({"skip": True}))
        assert result is False

    def test_returns_false_when_not_travel_is_true(self):
        """Backward compat — not_travel flag also triggers skip."""
        result = self._run(json.dumps({"not_travel": True}))
        assert result is False

    def test_returns_false_for_skip_with_extra_fields(self):
        """Extra fields alongside skip flag should still trigger skip."""
        result = self._run(json.dumps({"skip": True, "title": "should be ignored"}))
        assert result is False

    def test_marks_vlog_complete_not_failed_on_skip(self):
        """Non-travel vlogs are not failures — they processed fine."""
        all_sql: list[str] = []

        class CapturingPg(FakePgClient):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                all_sql.append(sql)

        capturing_clients = iter([_no_existing_kit_pg(), CapturingPg()])
        mock_response = _gemini_response(json.dumps({"skip": True}))

        with (
            patch("app.services.gemini_service.PgClient", side_effect=capturing_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = mock_response
            from app.services.gemini_service import generate_trip_kit
            generate_trip_kit("vlog-001", "juggling content", "Juggling", "creator-1")

        # The SQL that updates processingStatus should say COMPLETE, not FAILED
        status_sqls = [s for s in all_sql if "processingStatus" in s]
        assert len(status_sqls) >= 1, "Expected at least one processingStatus update"
        assert any("COMPLETE" in s for s in status_sqls)
        assert not any("FAILED" in s for s in status_sqls)

    def test_no_trip_kit_inserted_on_skip(self):
        """Ensure no INSERT into TripKit happens when skipping."""
        inserts = []

        class TrackingPg(FakePgClient):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if sql.strip().upper().startswith("INSERT"):
                    inserts.append(sql)

        clients = iter([_no_existing_kit_pg(), TrackingPg()])
        mock_response = _gemini_response(json.dumps({"skip": True}))

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = mock_response
            from app.services.gemini_service import generate_trip_kit
            generate_trip_kit("vlog-001", "juggling", "Juggling", "creator-1")

        assert len(inserts) == 0, f"Unexpected INSERT statements: {inserts}"


# ─────────────────────────────────────────────────────────────────────────────
# Compact fallback also respects skip
# ─────────────────────────────────────────────────────────────────────────────

class TestCompactFallbackSkip:

    def test_skip_in_compact_response_returns_false(self):
        """If primary returns bad JSON and compact returns skip, still skip."""
        clients = iter([_no_existing_kit_pg(), FakePgClient()])
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Primary attempt — return invalid JSON to force compact fallback
                m = MagicMock()
                m.text = "not json {"
                return m
            else:
                # Compact attempt — return skip
                m = MagicMock()
                m.text = json.dumps({"skip": True})
                return m

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.side_effect = side_effect
            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "juggling content", "Juggling", "creator-1")

        assert result is False

    def test_not_travel_in_compact_response_returns_false(self):
        """Backward compat flag also works in compact response."""
        clients = iter([_no_existing_kit_pg(), FakePgClient()])
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            m = MagicMock()
            m.text = "invalid json" if call_count == 1 else json.dumps({"not_travel": True})
            return m

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.side_effect = side_effect
            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "juggling", "Juggling", "creator-1")

        assert result is False


# ─────────────────────────────────────────────────────────────────────────────
# Real travel content still generates a kit
# ─────────────────────────────────────────────────────────────────────────────

class TestTravelContentProducesKit:

    def test_valid_itinerary_returns_true(self):
        """Ensure genuine travel content still produces a kit (no regression)."""
        # Sequence: check-existing, insert-kit, insert-vlog-link,
        #           insert-day, insert-activities×2, mark-complete
        clients = iter([
            FakePgClient(rows=[]),                                      # no existing kit
            FakePgClient(rows=[{"id": "kit-new"}]),                     # INSERT TripKit → RETURNING id
            FakePgClient(rows=[]),                                      # INSERT TripKitsOnVlogs
            FakePgClient(rows=[{"id": "day-1"}]),                       # INSERT ItineraryDay
            FakePgClient(rows=[]),                                      # INSERT DayActivity 1
            FakePgClient(rows=[]),                                      # INSERT DayActivity 2
            FakePgClient(rows=[]),                                      # UPDATE Vlog → COMPLETE
        ])

        mock_response = MagicMock()
        mock_response.text = json.dumps(VALID_ITINERARY)

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = mock_response
            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit(
                vlog_id="vlog-travel",
                transcript="We visited the Eiffel Tower and had dinner at Café de Flore.",
                title="Paris Vlog",
                creator_id="creator-1",
            )

        assert result is True

    def test_skip_false_does_not_trigger_skip_path(self):
        """{"skip": false} with valid days should proceed normally."""
        itinerary_with_skip_false = {**VALID_ITINERARY, "skip": False}

        clients = iter([
            FakePgClient(rows=[]),
            FakePgClient(rows=[{"id": "kit-new"}]),
            FakePgClient(rows=[]),
            FakePgClient(rows=[{"id": "day-1"}]),
            FakePgClient(rows=[]),
            FakePgClient(rows=[]),
            FakePgClient(rows=[]),
        ])

        mock_response = MagicMock()
        mock_response.text = json.dumps(itinerary_with_skip_false)

        with (
            patch("app.services.gemini_service.PgClient", side_effect=clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = mock_response
            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-1", "Paris trip transcript", "Paris Vlog", "creator-1")

        assert result is True


# ─────────────────────────────────────────────────────────────────────────────
# _mark_vlog_not_travel helper
# ─────────────────────────────────────────────────────────────────────────────

class TestMarkVlogNotTravel:

    def test_sets_complete_status(self):
        pg = FakePgClient()
        with patch("app.services.gemini_service.PgClient", return_value=pg):
            from app.services.gemini_service import _mark_vlog_not_travel
            _mark_vlog_not_travel("vlog-123")

        queries = pg.cursor.queries
        assert len(queries) == 1
        sql, params = queries[0]
        assert "COMPLETE" in sql
        assert params[0] == "vlog-123"

    def test_does_not_set_failed_status(self):
        pg = FakePgClient()
        with patch("app.services.gemini_service.PgClient", return_value=pg):
            from app.services.gemini_service import _mark_vlog_not_travel
            _mark_vlog_not_travel("vlog-123")

        sql = pg.cursor.queries[0][0]
        assert "FAILED" not in sql
