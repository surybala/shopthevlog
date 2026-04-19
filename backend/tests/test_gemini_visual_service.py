"""
Tests for Gemini visual opportunity extraction helpers.
"""
from unittest.mock import MagicMock, patch


def test_extract_visual_opportunities_returns_structured_signals():
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
        patch("app.services.gemini_service._client", return_value=mock_client),
    ):
        from app.services.gemini_service import extract_visual_opportunities

        signals = extract_visual_opportunities(
            b"image-bytes",
            "Tokyo vlog",
            "Hotel lobby frame",
            "image/jpeg",
        )

    assert len(signals) == 1
    assert signals[0]["title"] == "Park Hyatt Tokyo"


def test_extract_visual_opportunities_batch_returns_signals_grouped_by_frame_id():
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
        patch("app.services.gemini_service._client", return_value=mock_client),
    ):
        from app.services.gemini_service import extract_visual_opportunities_batch

        signals_by_frame = extract_visual_opportunities_batch(
            [
                {"frame_id": "frame-1", "image_bytes": b"frame-1", "content_type": "image/jpeg", "scene_summary": "Hotel lobby"},
                {"frame_id": "frame-2", "image_bytes": b"frame-2", "content_type": "image/jpeg", "scene_summary": "Luggage closeup"},
            ],
            "Tokyo vlog",
        )

    assert signals_by_frame["frame-1"][0]["title"] == "Park Hyatt Tokyo"
    assert signals_by_frame["frame-2"][0]["title"] == "Rimowa"


def test_extract_visual_opportunities_returns_empty_list_on_model_error():
    with patch("app.services.gemini_service._client", side_effect=RuntimeError("gemini unavailable")):
        from app.services.gemini_service import extract_visual_opportunities

        signals = extract_visual_opportunities(
            b"image-bytes",
            "Tokyo vlog",
        )

    assert signals == []


def test_extract_visual_opportunities_batch_returns_empty_signals_on_model_error():
    with patch("app.services.gemini_service._client", side_effect=RuntimeError("gemini unavailable")):
        from app.services.gemini_service import extract_visual_opportunities_batch

        signals = extract_visual_opportunities_batch(
            [{"frame_id": "frame-1", "image_bytes": b"frame-1", "content_type": "image/jpeg"}],
            "Tokyo vlog",
        )

    assert signals == {"frame-1": []}


def test_extract_visual_opportunities_batch_falls_back_to_per_frame_extraction_on_invalid_batch_json():
    mock_generate = MagicMock(
        side_effect=[
            MagicMock(text='{"frames":[{"frame_id":"frame-1","signals":[{"title":"broken"}]}'),  # invalid JSON
            MagicMock(
                text=(
                    '{"signals":[{"source_type":"ocr","entity_type":"place","subtype":"hotel",'
                    '"title":"Park Hyatt Tokyo","raw_label":"Park Hyatt Tokyo","description":"Hotel sign",'
                    '"confidence":0.91,"claim_type":"visited","evidence_summary":"Readable sign","attributes":{}}]}'
                )
            ),
            MagicMock(
                text=(
                    '{"signals":[{"source_type":"logo_detection","entity_type":"brand","subtype":"brand",'
                    '"title":"Rimowa","raw_label":"Rimowa","description":"Luggage logo",'
                    '"confidence":0.77,"claim_type":"used","evidence_summary":"Logo on suitcase","attributes":{}}]}'
                )
            ),
        ]
    )
    mock_client = MagicMock()
    mock_client.models.generate_content = mock_generate

    with patch("app.services.gemini_service._client", return_value=mock_client):
        from app.services.gemini_service import extract_visual_opportunities_batch

        signals_by_frame = extract_visual_opportunities_batch(
            [
                {"frame_id": "frame-1", "image_bytes": b"frame-1", "content_type": "image/jpeg", "scene_summary": "Hotel lobby"},
                {"frame_id": "frame-2", "image_bytes": b"frame-2", "content_type": "image/jpeg", "scene_summary": "Luggage closeup"},
            ],
            "Tokyo vlog",
        )

    assert signals_by_frame["frame-1"][0]["title"] == "Park Hyatt Tokyo"
    assert signals_by_frame["frame-2"][0]["title"] == "Rimowa"
