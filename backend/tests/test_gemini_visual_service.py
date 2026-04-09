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
                '{"frames":[{"frame_id":"frame-0","signals":[{"source_type":"ocr","entity_type":"place","subtype":"hotel",'
                '"title":"Park Hyatt Tokyo","raw_label":"Park Hyatt Tokyo","description":"Hotel sign",'
                '"confidence":0.91,"claim_type":"visited","evidence_summary":"Readable sign","attributes":{}}]}]}'
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


def test_extract_visual_opportunities_batch_returns_signals_grouped_by_frame_id():
    first_response = MagicMock()
    first_response.content = b"frame-1"
    first_response.headers = {"content-type": "image/jpeg"}
    first_response.raise_for_status.return_value = None

    second_response = MagicMock()
    second_response.content = b"frame-2"
    second_response.headers = {"content-type": "image/jpeg"}
    second_response.raise_for_status.return_value = None

    mock_generate = MagicMock(
        return_value=MagicMock(
            text=(
                '{"frames":['
                '{"frame_id":"frame-1","signals":[{"source_type":"ocr","entity_type":"place","subtype":"hotel",'
                '"title":"Park Hyatt Tokyo","raw_label":"Park Hyatt Tokyo","description":"Hotel sign",'
                '"confidence":0.91,"claim_type":"visited","evidence_summary":"Readable sign","attributes":{}}]},'
                '{"frame_id":"frame-2","signals":[{"source_type":"logo_detection","entity_type":"brand","subtype":"brand",'
                '"title":"Rimowa","raw_label":"Rimowa","description":"Luggage logo",'
                '"confidence":0.77,"claim_type":"used","evidence_summary":"Logo on suitcase","attributes":{}}]}'
                ']}'
            )
        )
    )
    mock_client = MagicMock()
    mock_client.models.generate_content = mock_generate

    with (
        patch("app.services.gemini_service.httpx.get", side_effect=[first_response, second_response]),
        patch("app.services.gemini_service._client", return_value=mock_client),
    ):
        from app.services.gemini_service import extract_visual_opportunities_batch

        signals_by_frame = extract_visual_opportunities_batch(
            [
                {"frame_id": "frame-1", "image_url": "https://storage.example.com/frame-1.jpg", "scene_summary": "Hotel lobby"},
                {"frame_id": "frame-2", "image_url": "https://storage.example.com/frame-2.jpg", "scene_summary": "Luggage closeup"},
            ],
            "Tokyo vlog",
        )

    assert signals_by_frame["frame-1"][0]["title"] == "Park Hyatt Tokyo"
    assert signals_by_frame["frame-2"][0]["title"] == "Rimowa"


def test_extract_visual_opportunities_returns_empty_list_on_fetch_error():
    with patch("app.services.gemini_service.httpx.get", side_effect=RuntimeError("network unavailable")):
        from app.services.gemini_service import extract_visual_opportunities

        signals = extract_visual_opportunities(
            "https://storage.example.com/frame.jpg",
            "Tokyo vlog",
        )

    assert signals == []


def test_extract_visual_opportunities_batch_returns_empty_signals_on_fetch_error():
    with patch("app.services.gemini_service.httpx.get", side_effect=RuntimeError("network unavailable")):
        from app.services.gemini_service import extract_visual_opportunities_batch

        signals = extract_visual_opportunities_batch(
            [{"frame_id": "frame-1", "image_url": "https://storage.example.com/frame-1.jpg"}],
            "Tokyo vlog",
        )

    assert signals == {"frame-1": []}
