"""
Tests for app.core.security — JWT verification and the get_current_user FastAPI dependency.

All tokens are verified via JWKS (ES256/RS256).  HS256 / legacy JWT secret
have been removed.  Tests mock _jwks() to avoid real network calls.
"""
import time
import pytest
from unittest.mock import MagicMock, patch

from jose import jwt, ExpiredSignatureError, JWTError
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

# ─── module under test ───────────────────────────────────────────────────────
from app.core.security import (
    _verify_token,
    _reset_jwks_cache,
    get_current_user,
    UserClaims,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

_HS256_SECRET = "test-jwt-secret-long-enough-for-hmac-256-bits!!"


def _make_hs256_token(payload: dict) -> str:
    """Make an HS256 token; useful only for testing the *failure* path since
    the backend no longer accepts HS256."""
    return jwt.encode(payload, _HS256_SECRET, algorithm="HS256")


def _valid_payload(sub="user-abc", email="user@example.com", exp_offset=3600) -> dict:
    return {
        "sub": sub,
        "email": email,
        "exp": int(time.time()) + exp_offset,
        "iat": int(time.time()),
    }


def _mock_jwks_decode_ok(payload: dict):
    """Patch jwt.decode to return a fixed payload (simulates successful JWKS verification)."""
    return patch("app.core.security.jwt.decode", return_value=payload)


def _mock_jwks_populated():
    """Return a non-empty JWKS dict so the JWKS path is taken."""
    return patch("app.core.security._jwks", return_value={"keys": [{"kty": "EC", "kid": "test"}]})


# ─────────────────────────────────────────────────────────────────────────────
# _verify_token — JWKS path
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyToken:
    def test_valid_token_returns_payload(self):
        expected = _valid_payload()
        with _mock_jwks_populated(), _mock_jwks_decode_ok(expected):
            result = _verify_token("fake.jwt.token")
        assert result["sub"] == "user-abc"
        assert result["email"] == "user@example.com"

    def test_expired_token_raises_immediately(self):
        """ExpiredSignatureError must be raised on first attempt — no retry."""
        with (
            _mock_jwks_populated(),
            patch("app.core.security.jwt.decode") as mock_decode,
        ):
            mock_decode.side_effect = ExpiredSignatureError("expired")
            with pytest.raises(ExpiredSignatureError):
                _verify_token("fake.jwt.token")
            # Must NOT retry for expired tokens
            assert mock_decode.call_count == 1

    def test_jwt_error_retries_once_after_cache_bust(self):
        """On JWTError the cache is cleared and the request is retried once."""
        good_payload = _valid_payload()
        call_count = {"n": 0}

        def _side_effect(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise JWTError("key mismatch")
            return good_payload

        with (
            _mock_jwks_populated(),
            patch("app.core.security.jwt.decode", side_effect=_side_effect),
            patch("app.core.security._reset_jwks_cache") as mock_reset,
        ):
            result = _verify_token("fake.jwt.token")

        assert result["sub"] == "user-abc"
        mock_reset.assert_called_once()

    def test_jwt_error_on_retry_raises(self):
        """If both attempts fail with JWTError, the exception propagates."""
        with (
            _mock_jwks_populated(),
            patch("app.core.security.jwt.decode", side_effect=JWTError("always fails")),
        ):
            with pytest.raises(JWTError):
                _verify_token("fake.jwt.token")

    def test_missing_sub_still_decodes(self):
        """_verify_token does not validate sub — that's get_current_user's job."""
        payload = {"email": "x@y.com", "exp": int(time.time()) + 3600}
        with _mock_jwks_populated(), _mock_jwks_decode_ok(payload):
            result = _verify_token("fake.jwt.token")
        assert result.get("sub") is None

    def test_hs256_token_rejected(self):
        """Tokens signed with HS256 are no longer accepted."""
        token = _make_hs256_token(_valid_payload())
        # Let real JWT decode run against real JWKS (empty → fails)
        with patch("app.core.security._jwks", return_value={"keys": []}):
            with pytest.raises(Exception):
                _verify_token(token)


# ─────────────────────────────────────────────────────────────────────────────
# get_current_user FastAPI dependency
# ─────────────────────────────────────────────────────────────────────────────

class TestGetCurrentUser:
    def _creds(self, token: str) -> HTTPAuthorizationCredentials:
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    def test_valid_token_returns_user_claims(self):
        payload = _valid_payload(sub="user-xyz", email="xyz@test.com")
        with _mock_jwks_populated(), _mock_jwks_decode_ok(payload):
            user = get_current_user(self._creds("fake.jwt.token"))
        assert isinstance(user, UserClaims)
        assert user.user_id == "user-xyz"
        assert user.email == "xyz@test.com"

    def test_no_credentials_raises_401(self):
        with pytest.raises(HTTPException) as exc:
            get_current_user(None)
        assert exc.value.status_code == 401
        assert "Not authenticated" in exc.value.detail

    def test_expired_token_raises_401(self):
        with (
            _mock_jwks_populated(),
            patch("app.core.security.jwt.decode", side_effect=ExpiredSignatureError("expired")),
        ):
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds("fake.jwt.token"))
        assert exc.value.status_code == 401
        assert "expired" in exc.value.detail.lower()

    def test_invalid_token_raises_401(self):
        with (
            _mock_jwks_populated(),
            patch("app.core.security.jwt.decode", side_effect=JWTError("bad token")),
        ):
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds("bad.token.value"))
        assert exc.value.status_code == 401

    def test_missing_sub_claim_raises_401(self):
        payload = {"email": "x@y.com", "exp": int(time.time()) + 3600}
        with _mock_jwks_populated(), _mock_jwks_decode_ok(payload):
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds("fake.jwt.token"))
        assert exc.value.status_code == 401
        assert "sub" in exc.value.detail.lower()

    def test_email_can_be_empty_string(self):
        """Email is optional — empty string is valid."""
        payload = _valid_payload(email="")
        with _mock_jwks_populated(), _mock_jwks_decode_ok(payload):
            user = get_current_user(self._creds("fake.jwt.token"))
        assert user.email == ""
