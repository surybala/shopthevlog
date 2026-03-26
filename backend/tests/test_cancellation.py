"""
Tests for downstream cancellation logic across providers.

Covers:
  duffel_service.cancel_flight_order  — success, 404, provider error, confirm failure
  duffel_service.cancel_hotel_order   — success, 404, provider error
  liteapi_service.cancel_hotel_booking — success, 404, provider error

All HTTP calls are fully mocked; no real network calls are made.
"""
import pytest
import json
from unittest.mock import MagicMock, patch

from app.services.duffel_service import cancel_flight_order, cancel_hotel_order
from app.services.liteapi_service import cancel_hotel_booking


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _resp(status: int, body: dict | str | None = None) -> MagicMock:
    r = MagicMock()
    r.status_code = status
    r.is_success = 200 <= status < 300
    if body is None:
        r.text = ""
        r.json.side_effect = ValueError("empty")
    elif isinstance(body, str):
        r.text = body
        r.json.side_effect = ValueError("not json")
    else:
        r.text = json.dumps(body)
        r.json.return_value = body
    return r


def _mock_flight_client(responses: list[MagicMock]):
    """Context-manager mock for duffel_service._client()."""
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.post.side_effect = responses
    return client


def _mock_stays_client(responses: list[MagicMock]):
    """Context-manager mock for duffel_service._stays_client()."""
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.delete.side_effect = responses
    return client


def _mock_liteapi_client(responses: list[MagicMock]):
    """Context-manager mock for liteapi_service._client()."""
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.delete.side_effect = responses
    return client


# ─── cancel_flight_order ──────────────────────────────────────────────────────

class TestCancelFlightOrder:
    def _run(self, *responses):
        mock_client = _mock_flight_client(list(responses))
        with patch("app.services.duffel_service._client", return_value=mock_client):
            return cancel_flight_order("ord_123")

    def test_success_returns_true(self):
        create_resp = _resp(201, {"data": {"id": "can_1"}})
        confirm_resp = _resp(200, {"data": {"status": "confirmed"}})
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = [create_resp, confirm_resp]
        with patch("app.services.duffel_service._client", return_value=mock_client):
            assert cancel_flight_order("ord_123") is True

    def test_404_on_create_treated_as_success(self):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _resp(404, {"errors": [{"message": "not found"}]})
        with patch("app.services.duffel_service._client", return_value=mock_client):
            assert cancel_flight_order("ord_already_gone") is True

    def test_provider_error_raises_value_error(self):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _resp(422, {
            "errors": [{"message": "This fare is non-refundable"}]
        })
        with patch("app.services.duffel_service._client", return_value=mock_client):
            with pytest.raises(ValueError, match="non-refundable"):
                cancel_flight_order("ord_nonrefund")

    def test_confirm_failure_raises_value_error(self):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        create_resp = _resp(201, {"data": {"id": "can_1"}})
        confirm_resp = _resp(500, {"errors": [{"message": "internal error"}]})
        mock_client.post.side_effect = [create_resp, confirm_resp]
        with patch("app.services.duffel_service._client", return_value=mock_client):
            with pytest.raises(ValueError, match="could not be confirmed"):
                cancel_flight_order("ord_confirm_fail")

    def test_error_message_included_in_exception(self):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _resp(409, {
            "errors": [{"message": "booking already cancelled"}]
        })
        with patch("app.services.duffel_service._client", return_value=mock_client):
            with pytest.raises(ValueError) as exc_info:
                cancel_flight_order("ord_already")
            assert "booking already cancelled" in str(exc_info.value)


# ─── cancel_hotel_order (Duffel Stays) ───────────────────────────────────────

class TestCancelHotelOrderDuffel:
    def _patched(self, responses: list):
        mock_client = _mock_stays_client(responses)
        with patch("app.services.duffel_service._stays_client", return_value=mock_client):
            return cancel_hotel_order("stays_bk_1")

    def test_success_returns_true(self):
        assert self._patched([_resp(200, {})]) is True

    def test_204_no_content_treated_as_success(self):
        assert self._patched([_resp(204, None)]) is True

    def test_404_treated_as_success(self):
        assert self._patched([_resp(404, {"errors": [{"message": "not found"}]})]) is True

    def test_provider_error_raises_value_error(self):
        mock_client = _mock_stays_client([
            _resp(422, {"errors": [{"message": "cancellation window has passed"}]})
        ])
        with patch("app.services.duffel_service._stays_client", return_value=mock_client):
            with pytest.raises(ValueError, match="declined"):
                cancel_hotel_order("stays_bk_expired")

    def test_error_message_included_in_exception(self):
        mock_client = _mock_stays_client([
            _resp(400, {"errors": [{"message": "non-refundable rate"}]})
        ])
        with patch("app.services.duffel_service._stays_client", return_value=mock_client):
            with pytest.raises(ValueError) as exc_info:
                cancel_hotel_order("stays_bk_bad")
            assert "non-refundable rate" in str(exc_info.value)


# ─── cancel_hotel_booking (LiteAPI) ──────────────────────────────────────────

class TestCancelHotelBookingLiteAPI:
    def _patched(self, responses: list):
        mock_client = _mock_liteapi_client(responses)
        with patch("app.services.liteapi_service._client", return_value=mock_client):
            return cancel_hotel_booking("lite_bk_1")

    def test_success_returns_true(self):
        assert self._patched([_resp(200, {"data": {"status": "cancelled"}})]) is True

    def test_404_treated_as_success(self):
        assert self._patched([_resp(404, {"message": "Booking not found"})]) is True

    def test_provider_error_raises_value_error(self):
        mock_client = _mock_liteapi_client([
            _resp(400, {"message": "Booking cannot be cancelled past check-in"})
        ])
        with patch("app.services.liteapi_service._client", return_value=mock_client):
            with pytest.raises(ValueError, match="declined"):
                cancel_hotel_booking("lite_bk_past_checkin")

    def test_error_message_in_exception(self):
        mock_client = _mock_liteapi_client([
            _resp(422, {"message": "Non-refundable booking"})
        ])
        with patch("app.services.liteapi_service._client", return_value=mock_client):
            with pytest.raises(ValueError) as exc_info:
                cancel_hotel_booking("lite_bk_nonrefund")
            assert "Non-refundable booking" in str(exc_info.value)

    def test_non_json_error_body_still_raises(self):
        mock_client = _mock_liteapi_client([_resp(500, "Internal Server Error")])
        with patch("app.services.liteapi_service._client", return_value=mock_client):
            with pytest.raises(ValueError):
                cancel_hotel_booking("lite_bk_500")
