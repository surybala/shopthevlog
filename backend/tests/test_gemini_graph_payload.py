"""
Tests for combined transcript graph extraction in app.services.gemini_service.
"""
import importlib
import json
import sys
from unittest.mock import MagicMock, patch

sys.modules.setdefault("google", MagicMock())
sys.modules.setdefault("google.genai", MagicMock())
sys.modules.setdefault("google.genai.types", MagicMock())
sys.modules.setdefault("psycopg2", MagicMock())
sys.modules.setdefault("psycopg2.extras", MagicMock())

import app.services
_gs = importlib.import_module("app.services.gemini_service")
app.services.gemini_service = _gs


def test_extract_transcript_graph_payload_returns_combined_response():
    combined = {
        "skip": False,
        "itinerary": {
            "title": "3 Days in Tokyo",
            "summary": "A tight Tokyo itinerary.",
            "total_days": 3,
            "destinations": ["Tokyo"],
            "countries": ["Japan"],
            "primary_city": "Tokyo",
            "estimated_budget_usd": None,
            "days": [],
        },
        "opportunities": [
            {
                "claim_type": "stayed_at",
                "entity_type": "place",
                "subtype": "hotel",
                "title": "Park Hyatt Tokyo",
                "raw_label": "Park Hyatt",
                "description": "Hotel check-in.",
                "confidence": 0.91,
                "start_sec": 15,
                "end_sec": 45,
                "evidence_summary": "Mentioned by name in transcript.",
                "attributes": {},
            },
        ],
    }

    with patch("app.services.gemini_service._call_gemini", return_value=json.dumps(combined)) as mock_call:
        from app.services.gemini_service import extract_transcript_graph_payload

        result = extract_transcript_graph_payload("Tokyo transcript", "Tokyo vlog")

    mock_call.assert_called_once()
    assert result == combined


def test_extract_transcript_graph_payload_falls_back_to_legacy_calls():
    with (
        patch("app.services.gemini_service._call_gemini", return_value="not-json"),
        patch(
            "app.services.gemini_service.extract_itinerary_blueprint",
            return_value={
                "title": "Fallback itinerary",
                "summary": "Recovered from fallback.",
                "total_days": 1,
                "destinations": ["Kyoto"],
                "countries": ["Japan"],
                "primary_city": "Kyoto",
                "estimated_budget_usd": None,
                "days": [],
            },
        ) as mock_itinerary,
        patch(
            "app.services.gemini_service.extract_transcript_opportunities",
            return_value=[
                {
                    "claim_type": "visited",
                    "entity_type": "place",
                    "subtype": "attraction",
                    "title": "Fushimi Inari Shrine",
                }
            ],
        ) as mock_opportunities,
    ):
        from app.services.gemini_service import extract_transcript_graph_payload

        result = extract_transcript_graph_payload("Kyoto transcript", "Kyoto vlog")

    mock_itinerary.assert_called_once_with("Kyoto transcript", "Kyoto vlog")
    mock_opportunities.assert_called_once_with("Kyoto transcript", "Kyoto vlog")
    assert result["skip"] is False
    assert result["itinerary"]["title"] == "Fallback itinerary"
    assert result["opportunities"][0]["title"] == "Fushimi Inari Shrine"
