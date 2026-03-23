"""
Tests for app.services.liteapi_service — focused on prebook_hotel edge cases.

The LiteAPI HTTP client is fully mocked; no real network calls are made.
"""
import pytest
from unittest.mock import MagicMock, patch

from app.services.liteapi_service import prebook_hotel
from app.core.exceptions import StaleOfferError


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _mock_resp(status_code: int, text: str) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    resp.is_success = 200 <= status_code < 300
    if text.strip():
        import json
        try:
            resp.json.return_value = json.loads(text)
        except Exception:
            resp.json.side_effect = ValueError("not json")
    else:
        resp.json.side_effect = ValueError("empty body")
    return resp


def _patched_client(resp: MagicMock):
    """Context manager that injects a fake HTTP response for /book/prebook."""
    client_mock = MagicMock()
    client_mock.__enter__ = MagicMock(return_value=client_mock)
    client_mock.__exit__ = MagicMock(return_value=False)
    client_mock.post.return_value = resp
    return patch("app.services.liteapi_service._client", return_value=client_mock)


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestPrebookHotel:
    def test_success_returns_prebook_id(self):
        resp = _mock_resp(200, '{"data": {"prebookId": "PB-123"}}')
        with _patched_client(resp):
            result = prebook_hotel("liteapi_hotel_RATE_ABC")
        assert result == "PB-123"

    def test_strips_liteapi_hotel_prefix_from_offer_id(self):
        resp = _mock_resp(200, '{"data": {"prebookId": "PB-456"}}')
        with _patched_client(resp) as patcher:
            prebook_hotel("liteapi_hotel_RAW_ID")
            client_instance = patcher.return_value.__enter__.return_value
            _, kwargs = client_instance.post.call_args
            assert kwargs["json"]["offerId"] == "RAW_ID"

    def test_empty_body_raises_stale_offer_error(self):
        """A 200 with empty body means the offer has expired — must raise StaleOfferError."""
        resp = _mock_resp(200, "")
        with _patched_client(resp):
            with pytest.raises(StaleOfferError):
                prebook_hotel("liteapi_hotel_EXPIRED")

    def test_whitespace_only_body_raises_stale_offer_error(self):
        """Whitespace-only body is treated the same as truly empty."""
        resp = _mock_resp(200, "   \n\t  ")
        with _patched_client(resp):
            with pytest.raises(StaleOfferError):
                prebook_hotel("liteapi_hotel_EXPIRED")

    def test_stale_offer_message_is_user_friendly(self):
        resp = _mock_resp(200, "")
        with _patched_client(resp):
            with pytest.raises(StaleOfferError) as exc_info:
                prebook_hotel("liteapi_hotel_EXPIRED")
        assert "no longer available" in str(exc_info.value).lower()

    def test_non_200_response_raises_value_error(self):
        resp = _mock_resp(422, '{"error": "invalid offer"}')
        with _patched_client(resp):
            with pytest.raises(ValueError, match="422"):
                prebook_hotel("liteapi_hotel_BAD")

    def test_missing_prebook_id_in_response_raises_value_error(self):
        resp = _mock_resp(200, '{"data": {}}')
        with _patched_client(resp):
            with pytest.raises(ValueError, match="prebookId"):
                prebook_hotel("liteapi_hotel_NO_ID")
