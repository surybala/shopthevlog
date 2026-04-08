"""
Tests for app.core.rate_limit — key function, storage resolution, and 429 handler.
"""
import pytest
from unittest.mock import MagicMock, patch


# ─────────────────────────────────────────────────────────────────────────────
# _get_user_or_ip
# ─────────────────────────────────────────────────────────────────────────────

class TestGetUserOrIp:
    def _make_request(self, user_id=None, remote_addr="1.2.3.4"):
        req = MagicMock()
        req.state = MagicMock()
        req.state.user_id = user_id
        # slowapi's get_remote_address reads from scope
        req.scope = {"type": "http", "client": (remote_addr, 12345)}
        req.client = MagicMock()
        req.client.host = remote_addr
        return req

    def test_returns_user_prefix_when_user_id_set(self):
        from app.core.rate_limit import _get_user_or_ip
        req = self._make_request(user_id="abc-123")
        result = _get_user_or_ip(req)
        assert result == "user:abc-123"

    def test_returns_ip_when_no_user_id(self):
        from app.core.rate_limit import _get_user_or_ip
        req = self._make_request(user_id=None)
        with patch("app.core.rate_limit.get_remote_address", return_value="1.2.3.4"):
            result = _get_user_or_ip(req)
        assert result == "1.2.3.4"

    def test_returns_ip_when_user_id_is_empty_string(self):
        from app.core.rate_limit import _get_user_or_ip
        req = self._make_request(user_id="")
        with patch("app.core.rate_limit.get_remote_address", return_value="5.6.7.8"):
            result = _get_user_or_ip(req)
        # empty string is falsy → falls back to IP
        assert result == "5.6.7.8"

    def test_returns_ip_when_state_has_no_user_id_attr(self):
        from app.core.rate_limit import _get_user_or_ip
        req = MagicMock()
        # no `user_id` attribute on state
        del req.state.user_id
        with patch("app.core.rate_limit.get_remote_address", return_value="9.9.9.9"):
            result = _get_user_or_ip(req)
        assert result == "9.9.9.9"


# ─────────────────────────────────────────────────────────────────────────────
# _resolve_storage_uri
# ─────────────────────────────────────────────────────────────────────────────

class TestResolveStorageUri:
    def test_returns_redis_url_when_redis_reachable(self):
        from app.core.rate_limit import _resolve_storage_uri

        mock_client = MagicMock()
        mock_client.ping.return_value = True

        with (
            patch("app.core.rate_limit.settings") as mock_settings,
            patch("redis.from_url", return_value=mock_client),
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            result = _resolve_storage_uri()

        assert result == "redis://localhost:6379"

    def test_returns_memory_when_redis_not_reachable(self):
        from app.core.rate_limit import _resolve_storage_uri

        with patch("redis.from_url", side_effect=Exception("connection refused")):
            result = _resolve_storage_uri()

        assert result == "memory://"

    def test_returns_memory_when_redis_ping_fails(self):
        from app.core.rate_limit import _resolve_storage_uri

        mock_client = MagicMock()
        mock_client.ping.side_effect = Exception("timeout")

        with patch("redis.from_url", return_value=mock_client):
            result = _resolve_storage_uri()

        assert result == "memory://"


# ─────────────────────────────────────────────────────────────────────────────
# rate_limit_exceeded_handler
# ─────────────────────────────────────────────────────────────────────────────

class TestRateLimitExceededHandler:
    def test_returns_429_json_response(self):
        from app.core.rate_limit import rate_limit_exceeded_handler
        from fastapi.responses import JSONResponse

        req = MagicMock()
        exc = MagicMock()
        exc.detail = "20 per 1 minute"

        resp = rate_limit_exceeded_handler(req, exc)

        assert isinstance(resp, JSONResponse)
        assert resp.status_code == 429

    def test_response_body_contains_detail_string(self):
        from app.core.rate_limit import rate_limit_exceeded_handler
        import json

        req = MagicMock()
        exc = MagicMock()
        exc.detail = "5 per 1 minute"

        resp = rate_limit_exceeded_handler(req, exc)
        body = json.loads(resp.body)

        assert "detail" in body
        assert "5 per 1 minute" in body["detail"]

    def test_response_body_mentions_retry(self):
        from app.core.rate_limit import rate_limit_exceeded_handler
        import json

        req = MagicMock()
        exc = MagicMock()
        exc.detail = "any limit"

        resp = rate_limit_exceeded_handler(req, exc)
        body = json.loads(resp.body)

        assert "retry" in body["detail"].lower() or "wait" in body["detail"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# Module-level constants
# ─────────────────────────────────────────────────────────────────────────────

class TestConstants:
    def test_search_limit_is_string(self):
        from app.core.rate_limit import SEARCH_LIMIT
        assert isinstance(SEARCH_LIMIT, str)
        assert "minute" in SEARCH_LIMIT

    def test_limiter_is_created(self):
        from app.core.rate_limit import limiter
        from slowapi import Limiter
        assert isinstance(limiter, Limiter)
