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
    """Context manager that injects a fake HTTP response for /rates/prebook."""
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

    def test_calls_rates_prebook_not_book_prebook(self):
        """Must POST to /rates/prebook — the old /book/prebook URL was wrong."""
        resp = _mock_resp(200, '{"data": {"prebookId": "PB-789"}}')
        with _patched_client(resp) as patcher:
            prebook_hotel("liteapi_hotel_RATE_CHECK")
            client_instance = patcher.return_value.__enter__.return_value
            args, _ = client_instance.post.call_args
            assert args[0] == "/rates/prebook"

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
        "bookingId": "BK-42",
        "bookingReference": "REF-42",
        "price": 350.0,
        "currency": "USD",
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

    def test_calls_rates_book_not_book_book(self):
        """Must POST to /rates/book — the old /book/book URL was wrong."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        args, _ = client.post.call_args
        assert args[0] == "/rates/book"

    def test_uses_provided_prebook_id_in_book_payload(self):
        """The prebookId sent to /rates/book must be exactly what was passed in."""
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

    def test_holder_uses_first_guest_as_primary_contact(self):
        """holder must use firstName/lastName/email/phone from the first guest."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        _, kwargs = client.post.call_args
        holder = kwargs["json"]["holder"]
        assert holder["firstName"] == "Alice"
        assert holder["lastName"] == "Smith"
        assert holder["email"] == "alice@test.com"
        assert holder["phone"] == "+15550001"

    def test_guests_array_includes_all_guests_with_occupancy_numbers(self):
        """Each guest in the guests array must have an occupancyNumber starting at 1."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        _, kwargs = client.post.call_args
        guests_arr = kwargs["json"]["guests"]
        assert len(guests_arr) == 2
        assert guests_arr[0]["occupancyNumber"] == 1
        assert guests_arr[0]["firstName"] == "Alice"
        assert guests_arr[1]["occupancyNumber"] == 2
        assert guests_arr[1]["firstName"] == "Bob"

    def test_payment_method_is_acc_credit_card(self):
        """B2B payment must use ACC_CREDIT_CARD (account balance), not card details."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        _, kwargs = client.post.call_args
        assert kwargs["json"]["payment"] == {"method": "ACC_CREDIT_CARD"}

    def test_empty_guest_list_sends_placeholder_guest(self):
        """An empty guest list must not crash — sends a single placeholder guest."""
        client = _book_client(_BOOK_RESP)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            create_hotel_order("liteapi_hotel_RATE", [], prebook_id="PB-X")
        _, kwargs = client.post.call_args
        guests_arr = kwargs["json"]["guests"]
        assert len(guests_arr) == 1
        assert guests_arr[0]["firstName"] == ""
        assert guests_arr[0]["occupancyNumber"] == 1

    def test_returns_normalised_booking_dict(self):
        """Successful call returns normalised id/reference/total_amount/currency/provider."""
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

    def test_normalises_price_field_when_bookingId_absent(self):
        """If response uses 'price' instead of 'totalAmount', it must still be captured."""
        resp_data = {"data": {"bookingId": "BK-99", "price": 450.0, "currency": "EUR"}}
        client = _book_client(resp_data)
        with patch("app.services.liteapi_service._client", return_value=client), \
             patch("app.services.liteapi_service.prebook_hotel"):
            result = create_hotel_order("liteapi_hotel_RATE", _GUESTS, prebook_id="PB-X")
        assert result["id"] == "BK-99"
        assert result["total_amount"] == "450.0"
        assert result["currency"] == "EUR"
