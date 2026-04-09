"""
Tests for Gemini visual opportunity extraction helpers.
"""
from unittest.mock import MagicMock, patch


def test_extract_visual_opportunities_returns_structured_signals():
    mock_response = MagicMock()
    mock_response.content = b"image-bytes"
    mock_response.headers = {"content-type": "image/jpeg"}
    mock_response.raise_for_status.return_value = None

    mock_generate = MagicMock(
        return_value=MagicMock(
            text=(
                '{"signals":[{"source_type":"ocr","entity_type":"place","subtype":"hotel",'
                '"title":"Park Hyatt Tokyo","raw_label":"Park Hyatt Tokyo","description":"Hotel sign",'
                '"confidence":0.91,"claim_type":"visited","evidence_summary":"Readable sign","attributes":{}}]}'
            )
        )
    )
    mock_client = MagicMock()
    mock_client.models.generate_content = mock_generate

    with (
        patch("app.services.gemini_service.httpx.get", return_value=mock_response),
        patch("app.services.gemini_service._client", return_value=mock_client),
    ):
        from app.services.gemini_service import extract_visual_opportunities

        signals = extract_visual_opportunities(
            "https://storage.example.com/frame.jpg",
            "Tokyo vlog",
            "Hotel lobby frame",
        )

    assert len(signals) == 1
    assert signals[0]["title"] == "Park Hyatt Tokyo"


def test_extract_visual_opportunities_returns_empty_list_on_fetch_error():
    with patch("app.services.gemini_service.httpx.get", side_effect=RuntimeError("network unavailable")):
        from app.services.gemini_service import extract_visual_opportunities

        signals = extract_visual_opportunities(
            "https://storage.example.com/frame.jpg",
            "Tokyo vlog",
        )

    assert signals == []
