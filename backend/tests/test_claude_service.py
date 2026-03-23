"""
Tests for app.services.claude_service — itinerary generation and destination extraction.

The Claude API and Supabase are fully mocked; no real network calls are made.
"""
import json
import pytest
from unittest.mock import MagicMock, patch, call

# ─── module under test ───────────────────────────────────────────────────────
# Import after env vars are set by conftest.py
from app.services.claude_service import generate_itinerary, extract_destinations


# ─── Shared fixture data ─────────────────────────────────────────────────────

VALID_ITINERARY = {
    "title": "3 Days in Tokyo",
    "summary": "A quick trip to Japan's capital.",
    "total_days": 3,
    "destinations": ["Tokyo", "Japan"],
    "estimated_budget_usd": 150,
    "days": [
        {
            "day_number": 1,
            "location": "Tokyo",
            "title": "Arrival Day",
            "description": "Land and explore Shibuya.",
            "activities": [
                {
                    "order_index": 1,
                    "type": "activity",
                    "name": "Shibuya Crossing",
                    "description": "Experience the famous crossing.",
                    "location_name": "Shibuya, Tokyo",
                    "lat": 35.6595,
                    "lng": 139.7004,
                    "estimated_cost_usd": 0,
                    "duration_minutes": 30,
                    "booking_url": None,
                    "image_url": None,
                }
            ],
        }
    ],
}


def _claude_response(raw: str) -> MagicMock:
    """Build a mock Anthropic message response."""
    msg = MagicMock()
    msg.stop_reason = "end_turn"
    msg.content = [MagicMock(text=raw)]
    return msg


def _db_no_existing_itinerary() -> MagicMock:
    """Supabase mock: no existing itinerary for the vlog."""
    db = MagicMock()
    # Counts scoped at db level so they persist across multiple .table() calls.
    _counts: dict[str, int] = {}

    def table_side_effect(name):
        t = MagicMock()
        for m in ("select", "eq", "limit", "insert", "update", "upsert"):
            getattr(t, m).return_value = t

        if name == "itineraries":
            def execute_itin():
                n = _counts.get("itineraries", 0)
                _counts["itineraries"] = n + 1
                if n == 0:
                    return MagicMock(data=[])                       # no existing
                return MagicMock(data=[{"id": "itin-new-001"}])     # insert result
            t.execute.side_effect = execute_itin

        elif name == "itinerary_days":
            t.execute.return_value = MagicMock(data=[{"id": "day-001"}])

        elif name == "itinerary_activities":
            t.execute.return_value = MagicMock(data=[{"id": "act-001"}])

        elif name == "vlogs":
            t.execute.return_value = MagicMock(data=[])   # update OK

        else:
            t.execute.return_value = MagicMock(data=[])

        return t

    db.table.side_effect = table_side_effect
    return db


def _db_existing_itinerary() -> MagicMock:
    """Supabase mock: itinerary already exists for the vlog."""
    db = MagicMock()

    def table_side_effect(name):
        t = MagicMock()
        for m in ("select","eq","limit","insert","update","upsert"):
            getattr(t, m).return_value = t
        if name == "itineraries":
            t.execute.return_value = MagicMock(data=[{"id": "itin-existing"}])
        elif name == "vlogs":
            t.execute.return_value = MagicMock(data=[])
        else:
            t.execute.return_value = MagicMock(data=[])
        return t

    db.table.side_effect = table_side_effect
    return db


# ─────────────────────────────────────────────────────────────────────────────
# generate_itinerary
# ─────────────────────────────────────────────────────────────────────────────

class TestGenerateItinerary:
    def test_success_returns_true(self):
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(json.dumps(VALID_ITINERARY))

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            result = generate_itinerary("vlog-001", "...transcript...", "3 Days in Tokyo")

        assert result is True

    def test_existing_itinerary_skips_claude_and_returns_true(self):
        db = _db_existing_itinerary()

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            result = generate_itinerary("vlog-001", "...transcript...", "Any Title")
            # Claude should NOT have been called
            mock_claude.messages.create.assert_not_called()

        assert result is True

    def test_invalid_json_from_claude_returns_false(self):
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response("This is not JSON at all!!!")

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            result = generate_itinerary("vlog-001", "transcript", "Title")

        assert result is False

    def test_markdown_fence_stripped_before_json_parse(self):
        """Claude sometimes wraps JSON in ```json ... ``` despite instructions."""
        wrapped = f"```json\n{json.dumps(VALID_ITINERARY)}\n```"
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(wrapped)

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            result = generate_itinerary("vlog-001", "transcript", "Title")

        assert result is True

    def test_plain_backtick_fence_stripped(self):
        """Handle ``` without language specifier."""
        wrapped = f"```\n{json.dumps(VALID_ITINERARY)}\n```"
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(wrapped)

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            result = generate_itinerary("vlog-001", "transcript", "Title")

        assert result is True

    def test_max_tokens_stop_reason_returns_false(self):
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response("{}")
        claude_mock.stop_reason = "max_tokens"

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            result = generate_itinerary("vlog-001", "transcript", "Title")

        assert result is False

    def test_claude_api_exception_returns_false(self):
        db = _db_no_existing_itinerary()

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.side_effect = RuntimeError("Network error")
            result = generate_itinerary("vlog-001", "transcript", "Title")

        assert result is False

    def test_vlog_set_to_ready_on_success(self):
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(json.dumps(VALID_ITINERARY))
        updated_statuses: list[str | None] = []
        original_side_effect = db.table.side_effect

        def capturing_table(name):
            t = original_side_effect(name)
            if name == "vlogs":
                _t = t  # captured in closure — avoids recursive side_effect call

                def track_update(data):
                    updated_statuses.append(data.get("processing_status"))
                    return _t  # return table mock for chaining .eq().execute()

                t.update.side_effect = track_update
            return t

        db.table.side_effect = capturing_table

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            generate_itinerary("vlog-001", "transcript", "Title")

        assert "ready" in updated_statuses

    def test_vlog_set_to_failed_on_json_error(self):
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response("not json")
        failed_statuses: list[str | None] = []
        original_side_effect = db.table.side_effect

        def capturing_table(name):
            t = original_side_effect(name)
            if name == "vlogs":
                _t = t

                def track_update(data):
                    failed_statuses.append(data.get("processing_status"))
                    return _t

                t.update.side_effect = track_update
            return t

        db.table.side_effect = capturing_table

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            generate_itinerary("vlog-001", "transcript", "Title")

        assert "failed" in failed_statuses

    def test_transcript_truncated_to_30k_chars(self):
        """Very long transcripts must be sliced before being sent to Claude."""
        long_transcript = "word " * 10_000   # 50 000 chars
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(json.dumps(VALID_ITINERARY))
        captured_content = []

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            def capture(**kwargs):
                captured_content.append(kwargs["messages"][0]["content"])
                return claude_mock

            mock_claude.messages.create.side_effect = capture
            generate_itinerary("vlog-001", long_transcript, "Long Vlog")

        assert captured_content
        # The user message should not contain more than 30000 transcript characters
        # (plus the "Vlog title: ..." prefix)
        assert len(captured_content[0]) < 35_000

    def test_days_and_activities_inserted(self):
        """All days and activities from Claude's response must be persisted."""
        db = _db_no_existing_itinerary()
        claude_mock = _claude_response(json.dumps(VALID_ITINERARY))
        insert_calls_by_table = {"itinerary_days": 0, "itinerary_activities": 0}

        original_side_effect = db.table.side_effect

        def counting_table(name):
            t = original_side_effect(name)
            if name in insert_calls_by_table:
                _name = name
                _t = t

                def track_insert(data):
                    insert_calls_by_table[_name] += 1
                    return _t  # return for chaining .execute()

                t.insert.side_effect = track_insert
            return t

        db.table.side_effect = counting_table

        with (
            patch("app.services.claude_service.get_supabase", return_value=db),
            patch("app.services.claude_service.claude") as mock_claude,
        ):
            mock_claude.messages.create.return_value = claude_mock
            generate_itinerary("vlog-001", "transcript", "Title")

        assert insert_calls_by_table["itinerary_days"] == len(VALID_ITINERARY["days"])
        assert insert_calls_by_table["itinerary_activities"] == sum(
            len(d["activities"]) for d in VALID_ITINERARY["days"]
        )


# ─────────────────────────────────────────────────────────────────────────────
# extract_destinations
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractDestinations:
    def test_returns_list_of_destinations(self):
        destinations = ["Tokyo", "Japan", "Osaka"]
        msg = MagicMock()
        msg.content = [MagicMock(text=json.dumps(destinations))]

        with patch("app.services.claude_service.claude") as mock_claude:
            mock_claude.messages.create.return_value = msg
            result = extract_destinations("Some transcript about Japan...", "Japan Trip")

        assert result == destinations

    def test_returns_empty_list_on_claude_error(self):
        with patch("app.services.claude_service.claude") as mock_claude:
            mock_claude.messages.create.side_effect = RuntimeError("timeout")
            result = extract_destinations("transcript", "title")

        assert result == []

    def test_returns_empty_list_on_invalid_json(self):
        msg = MagicMock()
        msg.content = [MagicMock(text="not valid json")]

        with patch("app.services.claude_service.claude") as mock_claude:
            mock_claude.messages.create.return_value = msg
            result = extract_destinations("transcript", "title")

        assert result == []

    def test_long_transcript_truncated_to_4000(self):
        long_text = "x" * 10_000
        msg = MagicMock()
        msg.content = [MagicMock(text='["Destination"]')]
        captured = []

        with patch("app.services.claude_service.claude") as mock_claude:
            def capture(**kwargs):
                captured.append(kwargs["messages"][0]["content"])
                return msg
            mock_claude.messages.create.side_effect = capture
            extract_destinations(long_text, "Title")

        assert captured
        # Transcript portion is capped at 4000 chars
        assert len(captured[0]) < 5_000
