"""
Tests for app.services.liteapi_service — focused on prebook_hotel edge cases.

The LiteAPI HTTP client is fully mocked; no real network calls are made.
"""
import pytest
from unittest.mock import MagicMock, patch

from app.services.liteapi_service import prebook_hotel, create_hotel_order
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


# ─── create_hotel_order ───────────────────────────────────────────────────────

def _book_client(resp_data: dict) -> MagicMock:
    """Mock _client() for the /book/book call, returning a successful response."""
    import json
    resp = MagicMock()
    resp.status_code = 200
    resp.is_success = True
    resp.text = json.dumps(resp_data)
    resp.json.return_value = resp_data
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.post.return_value = resp
    return client


_BOOK_RESP = {
    "data": {
        "booking": {
            "bookingId": "BK-42",
            "bookingReference": "REF-42",
            "totalAmount": 350.0,
            "currency": "USD",
        }
    }
}

_GUESTS = [
    {"given_name": "Alice", "family_name": "Smith", "email": "alice@test.com", "phone_number": "+15550001"},
    {"given_name": "Bob",   "family_name": "Jones", "email": "bob@test.com",   "phone_number": "+15550002"},
]


class TestCreateHotelOrder:
    def test_skips_prebook_when_prebook_id_provided(self):
        """When a prebookId is passed in, prebook_hotel() must NOT be called."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel") as mock_prebook:
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-PROVIDED")
        mock_prebook.assert_not_called()

    def test_calls_prebook_when_no_prebook_id(self):
        """When prebook_id=None the function must call prebook_hotel automatically."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel", return_value="PB-AUTO") as mock_prebook:
            create_hotel_order("liteapi_hotel_RATE_XYZ", _GUESTS)
        mock_prebook.assert_called_once_with("liteapi_hotel_RATE_XYZ")

    def test_uses_provided_prebook_id_in_book_payload(self):
        """The prebookId sent to /book/book must be exactly what was passed in."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-SPECIFIC")
        _, kwargs = client.post.call_args
        assert kwargs["json"]["prebookId"] == "PB-SPECIFIC"

    def test_uses_auto_prebook_id_in_book_payload(self):
        """When prebook is called automatically, its return value becomes the prebookId."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel", return_value="PB-FROM-PREBOOK"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS)
        _, kwargs = client.post.call_args
        assert kwargs["json"]["prebookId"] == "PB-FROM-PREBOOK"

    def test_includes_guest_phone_in_payload(self):
        """guestPhone is now a required field — must be present in the /book/book body."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        _, kwargs = client.post.call_args
        assert kwargs["json"]["guestInfo"]["guestPhone"] == "+15550001"

    def test_first_guest_is_primary_contact(self):
        """First element in the guests list supplies guestFirstName/LastName/Email/Phone."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        _, kwargs = client.post.call_args
        gi = kwargs["json"]["guestInfo"]
        assert gi["guestFirstName"] == "Alice"
        assert gi["guestLastName"] == "Smith"
        assert gi["guestEmail"] == "alice@test.com"
        assert gi["guestPhone"] == "+15550001"

    def test_empty_guest_list_sends_empty_strings(self):
        """An empty guest list must not crash — sends empty strings for all guestInfo fields."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", [], prebook_id="PB-X")
        _, kwargs = client.post.call_args
        gi = kwargs["json"]["guestInfo"]
        assert gi["guestFirstName"] == ""
        assert gi["guestPhone"] == ""

    def test_returns_normalised_booking_dict(self):
        """Successful call must return the normalised id/reference/total_amount/currency/provider dict."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            result = create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        assert result["id"] == "BK-42"
        assert result["reference"] == "REF-42"
        assert result["currency"] == "USD"
        assert result["provider"] == "liteapi"

    def test_total_amount_is_string(self):
        """total_amount must be a string (backend stores it as text)."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            result = create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        assert isinstance(result["total_amount"], str)
