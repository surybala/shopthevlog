"""
Tests for app.services.gemini_service — TripKit generation via Gemini Flash Lite.

All external calls (Gemini API, PostgreSQL) are fully mocked.
No real network or DB calls are made.
"""
import json
import pytest
from unittest.mock import MagicMock, patch, call

from tests.conftest import FakePgClient


# ─── Helpers ─────────────────────────────────────────────────────────────────

VALID_ITINERARY = {
    "title": "5 Days in Tokyo",
    "summary": "A fantastic trip through Japan's capital city.",
    "total_days": 5,
    "destinations": ["Tokyo", "Shinjuku", "Shibuya"],
    "countries": ["Japan"],
    "primary_city": "Tokyo",
    "estimated_budget_usd": 2000,
    "days": [
        {
            "day_number": 1,
            "city": "Tokyo",
            "country": "Japan",
            "title": "Arrival & Shinjuku",
            "summary": "Land at Narita and head straight to Shinjuku.",
            "activities": [
                {
                    "sort_order": 0,
                    "type": "TRANSPORT",
                    "title": "Narita Express to Shinjuku",
                    "description": "Take the N'EX from Narita airport to Shinjuku station.",
                    "time": "14:00",
                    "latitude": 35.6896,
                    "longitude": 139.7006,
                    "image_url": None,
                },
                {
                    "sort_order": 1,
                    "type": "ACCOMMODATION",
                    "title": "Check-in Park Hyatt",
                    "description": "Iconic hotel with skyline views.",
                    "time": "16:00",
                    "latitude": 35.6867,
                    "longitude": 139.6921,
                    "image_url": None,
                },
            ],
        }
    ],
}


def _make_gemini_response(text: str) -> MagicMock:
    mock = MagicMock()
    mock.text = text
    return mock


def _make_multi_pg(call_sequence: list[list[dict]]):
    """
    Returns a list of FakePgClient instances, one per `with PgClient() as db:` call.
    patch("app.services.gemini_service.PgClient") should side_effect=iter(clients).
    """
    clients = [FakePgClient(rows) for rows in call_sequence]
    return clients


# ─────────────────────────────────────────────────────────────────────────────
# generate_trip_kit
# ─────────────────────────────────────────────────────────────────────────────

class TestGenerateTripKit:

    def _patch_pg_sequence(self, call_sequence: list[list[dict]]):
        """Return a side_effect list of context managers for PgClient()."""
        return _make_multi_pg(call_sequence)

    def test_success_returns_true(self):
        """Happy path: Gemini returns valid JSON, all DB writes succeed."""
        # Call sequence: [guard check (no existing kit), insert TripKit, insert day, ...]
        pg_clients = self._patch_pg_sequence([
            [],                                      # guard: no TripKitsOnVlogs row
            [{"id": "kit-001"}],                     # INSERT TripKit RETURNING id
            [{"id": "day-001"}],                     # INSERT ItineraryDay RETURNING id
            [],                                      # INSERT DayActivity (transport)
            [],                                      # INSERT DayActivity (accommodation)
            [],                                      # INSERT TripKitsOnVlogs
            [],                                      # UPDATE Vlog COMPLETE
        ])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response(json.dumps(VALID_ITINERARY))

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript text", "5 Days in Tokyo", "creator-001")

        assert result is True

    def test_existing_kit_skips_generation(self):
        """If a TripKitsOnVlogs row already exists, skip Gemini and mark COMPLETE."""
        pg_clients = self._patch_pg_sequence([
            [{"tripKitId": "kit-existing"}],  # guard: kit already exists
            [],                                # UPDATE Vlog COMPLETE
        ])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

            mock_client.assert_not_called()

        assert result is True

    def test_invalid_json_triggers_compact_fallback(self):
        """Primary call returns invalid JSON → compact fallback is tried."""
        pg_clients = self._patch_pg_sequence([
            [],                       # guard
            [{"id": "kit-001"}],      # insert TripKit
            [{"id": "day-001"}],      # insert day
            [], [],                   # insert activities
            [],                       # insert junction
            [],                       # update vlog complete
        ])

        call_count = {"n": 0}

        def generate_side_effect(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return _make_gemini_response("this is not json {{{")
            return _make_gemini_response(json.dumps(VALID_ITINERARY))

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.side_effect = generate_side_effect

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is True
        assert mock_client.return_value.models.generate_content.call_count == 2

    def test_both_attempts_fail_returns_false_and_marks_vlog_failed(self):
        """If both primary and compact calls return unparseable JSON, return False."""
        pg_clients = self._patch_pg_sequence([
            [],   # guard
            [],   # UPDATE Vlog FAILED
        ])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response("not json at all")

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is False

    def test_gemini_api_exception_returns_false(self):
        """If Gemini raises, return False gracefully."""
        pg_clients = self._patch_pg_sequence([[], []])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.side_effect = \
                RuntimeError("Gemini timeout")

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is False

    def test_missing_gemini_key_raises_on_client_init(self):
        """_client() should raise RuntimeError when GEMINI_API_KEY is empty."""
        import app.services.gemini_service as svc

        # Reset cached client so the lazy-init path runs.
        svc._gemini_client = None
        try:
            # Patch the settings object used inside claude_service directly.
            with patch("app.services.gemini_service.settings") as mock_settings:
                mock_settings.GEMINI_API_KEY = ""
                with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
                    svc._client()
        finally:
            svc._gemini_client = None  # reset so other tests get a fresh client

    def test_code_fence_stripped_before_parse(self):
        """Gemini sometimes wraps JSON in ```json ... ``` — it must be stripped."""
        fenced = f"```json\n{json.dumps(VALID_ITINERARY)}\n```"
        pg_clients = self._patch_pg_sequence([
            [], [{"id": "kit-001"}], [{"id": "day-001"}], [], [], [], [],
        ])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response(fenced)

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is True

    def test_empty_response_text_returns_false(self):
        """Empty string from Gemini should be treated as a failed generation."""
        pg_clients = self._patch_pg_sequence([[], []])

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response("")

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is False

    def test_transcript_truncated_to_30k_chars(self):
        """Transcripts longer than 30 000 chars must be sliced before sending."""
        long_transcript = "word " * 8_000   # 40 000 chars
        captured_calls = []

        pg_clients = self._patch_pg_sequence([
            [], [{"id": "kit-001"}], [{"id": "day-001"}], [], [], [], [],
        ])

        def capture_call(*args, **kwargs):
            captured_calls.append(kwargs.get("contents", args[0] if args else ""))
            return _make_gemini_response(json.dumps(VALID_ITINERARY))

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.side_effect = capture_call

            from app.services.gemini_service import generate_trip_kit
            generate_trip_kit("vlog-001", long_transcript, "Long Vlog", "creator-001")

        assert captured_calls, "Gemini was never called"
        # The user content string should contain at most 30 000 transcript chars
        # plus a small title prefix — total well under 35 000
        assert len(captured_calls[0]) < 35_000

    def test_invalid_activity_type_falls_back_to_other(self):
        """Unknown activity types should be coerced to 'OTHER' before DB insert."""
        itinerary = dict(VALID_ITINERARY)
        itinerary["days"] = [
            {
                **VALID_ITINERARY["days"][0],
                "activities": [
                    {**VALID_ITINERARY["days"][0]["activities"][0], "type": "UNKNOWN_TYPE"},
                ],
            }
        ]

        pg_clients = self._patch_pg_sequence([
            [], [{"id": "kit-001"}], [{"id": "day-001"}], [], [], [],
        ])

        inserted_types: list[str] = []
        clients_iter = iter(pg_clients)

        def pg_side_effect():
            client = next(clients_iter)
            original_execute = client.execute

            def capturing_execute(sql, params=None):
                if params and "OTHER" in str(params):
                    inserted_types.append("OTHER")
                original_execute(sql, params)

            client.execute = capturing_execute
            return client

        with (
            patch("app.services.gemini_service.PgClient", side_effect=pg_clients),
            patch("app.services.gemini_service._client") as mock_client,
        ):
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response(json.dumps(itinerary))

            from app.services.gemini_service import generate_trip_kit
            result = generate_trip_kit("vlog-001", "transcript", "Title", "creator-001")

        assert result is True

    def test_slugify_produces_url_safe_slug(self):
        """_slugify should strip non-alphanumeric chars and append a short hash."""
        from app.services.gemini_service import _slugify
        slug = _slugify("Tokyo: 10 Days & Nights!", "creator-xyz")
        assert " " not in slug
        assert ":" not in slug
        assert "&" not in slug
        assert "!" not in slug
        assert len(slug) > 6   # must have suffix


# ─────────────────────────────────────────────────────────────────────────────
# extract_destinations
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractDestinations:

    def test_returns_parsed_list(self):
        destinations = ["Tokyo", "Japan", "Kyoto"]
        with patch("app.services.gemini_service._client") as mock_client:
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response(json.dumps(destinations))

            from app.services.gemini_service import extract_destinations
            result = extract_destinations("Visited Tokyo and Kyoto...", "Japan Trip")

        assert result == destinations

    def test_returns_empty_list_on_api_error(self):
        with patch("app.services.gemini_service._client") as mock_client:
            mock_client.return_value.models.generate_content.side_effect = \
                RuntimeError("network error")

            from app.services.gemini_service import extract_destinations
            result = extract_destinations("transcript", "title")

        assert result == []

    def test_returns_empty_list_on_invalid_json(self):
        with patch("app.services.gemini_service._client") as mock_client:
            mock_client.return_value.models.generate_content.return_value = \
                _make_gemini_response("not a json array")

            from app.services.gemini_service import extract_destinations
            result = extract_destinations("transcript", "title")

        assert result == []

    def test_transcript_truncated_to_4000_chars(self):
        long_text = "x" * 10_000
        captured = []

        def capture(*args, **kwargs):
            captured.append(kwargs.get("contents", ""))
            return _make_gemini_response('["Paris"]')

        with patch("app.services.gemini_service._client") as mock_client:
            mock_client.return_value.models.generate_content.side_effect = capture

            from app.services.gemini_service import extract_destinations
            extract_destinations(long_text, "Title")

        assert captured
        assert len(captured[0]) < 5_500   # 4000 transcript + short prefix


# ─────────────────────────────────────────────────────────────────────────────
# _mark_vlog_complete / _mark_vlog_failed  (helper coverage)
# ─────────────────────────────────────────────────────────────────────────────

class TestVlogStatusHelpers:

    def test_mark_complete_issues_update(self):
        fake = FakePgClient(rows=[])
        with patch("app.services.gemini_service.PgClient", return_value=fake):
            from app.services.gemini_service import _mark_vlog_complete
            _mark_vlog_complete("vlog-001")

        sql, params = fake.cursor.queries[0]
        assert "COMPLETE" in sql
        assert params == ("vlog-001",)

    def test_mark_failed_issues_update(self):
        fake = FakePgClient(rows=[])
        with patch("app.services.gemini_service.PgClient", return_value=fake):
            from app.services.gemini_service import _mark_vlog_failed
            _mark_vlog_failed("vlog-001")

        sql, params = fake.cursor.queries[0]
        assert "FAILED" in sql
        assert params == ("vlog-001",)
