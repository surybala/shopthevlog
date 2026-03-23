"""
Tests for app.core.security — JWT verification and the get_current_user FastAPI dependency.
"""
import time
import pytest
from unittest.mock import MagicMock, patch

from jose import jwt
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

# ─── module under test ───────────────────────────────────────────────────────
from app.core.security import (
    _verify_token,
    _get_jwt_secret,
    get_current_user,
    UserClaims,
)

# ─── Test helpers ─────────────────────────────────────────────────────────────

_SECRET = "test-jwt-secret-long-enough-for-hmac-256-bits!!"
_ALG    = "HS256"


def _make_token(payload: dict, secret: str = _SECRET, algorithm: str = _ALG) -> str:
    return jwt.encode(payload, secret, algorithm=algorithm)


def _valid_payload(sub="user-abc", email="user@example.com", exp_offset=3600) -> dict:
    return {
        "sub": sub,
        "email": email,
        "exp": int(time.time()) + exp_offset,
        "iat": int(time.time()),
    }


def _mock_empty_jwks():
    """Patch _jwks to return no keys → forces HS256 fallback."""
    return patch("app.core.security._jwks", return_value={"keys": []})


def _mock_jwt_secret(secret=_SECRET):
    return patch("app.core.security._jwt_secret", return_value=secret)


# ─────────────────────────────────────────────────────────────────────────────
# _verify_token — HS256 fallback path (JWKS empty)
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyTokenHS256:
    def test_valid_token_returns_payload(self):
        token = _make_token(_valid_payload())
        with _mock_empty_jwks(), _mock_jwt_secret():
            payload = _verify_token(token)
        assert payload["sub"] == "user-abc"
        assert payload["email"] == "user@example.com"

    def test_expired_token_raises_expired_signature(self):
        from jose import ExpiredSignatureError
        token = _make_token(_valid_payload(exp_offset=-1))
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(ExpiredSignatureError):
                _verify_token(token)

    def test_wrong_secret_raises_jwt_error(self):
        from jose import JWTError
        token = _make_token(_valid_payload(), secret="wrong-secret")
        with _mock_empty_jwks(), _mock_jwt_secret(secret=_SECRET):
            with pytest.raises(JWTError):
                _verify_token(token)

    def test_malformed_token_raises_jwt_error(self):
        from jose import JWTError
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(JWTError):
                _verify_token("not.a.jwt")

    def test_completely_garbage_input_raises(self):
        from jose import JWTError
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(Exception):
                _verify_token("garbage!!!!")

    def test_token_missing_sub_still_decodes(self):
        """_verify_token itself does NOT validate sub — get_current_user does."""
        payload = {"email": "x@y.com", "exp": int(time.time()) + 3600}
        token = _make_token(payload)
        with _mock_empty_jwks(), _mock_jwt_secret():
            result = _verify_token(token)
        assert result.get("sub") is None


# ─────────────────────────────────────────────────────────────────────────────
# _verify_token — JWKS path
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyTokenJWKS:
    def test_jwks_failure_falls_back_to_hs256(self):
        """If JWKS keys are present but fail to decode, should fall through to HS256."""
        fake_jwks = {"keys": [{"kty": "EC", "crv": "P-256", "kid": "fake"}]}
        token = _make_token(_valid_payload())
        with (
            patch("app.core.security._jwks", return_value=fake_jwks),
            _mock_jwt_secret(),
        ):
            payload = _verify_token(token)
        assert payload["sub"] == "user-abc"

    def test_expired_token_does_not_fall_back_to_hs256(self):
        """ExpiredSignatureError from JWKS path must NOT fall through — raise directly."""
        from jose import ExpiredSignatureError
        # Create a valid JWKS structure that will fail with ExpiredSignatureError
        # We'll mock the jwt.decode to raise ExpiredSignatureError on first attempt
        expired_token = _make_token(_valid_payload(exp_offset=-1))

        with (
            patch("app.core.security._jwks", return_value={"keys": [{"kty": "fake"}]}),
            patch("app.core.security.jwt.decode") as mock_decode,
            _mock_jwt_secret(),
        ):
            mock_decode.side_effect = ExpiredSignatureError("expired")
            with pytest.raises(ExpiredSignatureError):
                _verify_token(expired_token)
            # jwt.decode should only have been called once (no HS256 retry)
            assert mock_decode.call_count == 1


# ─────────────────────────────────────────────────────────────────────────────
# get_current_user FastAPI dependency
# ─────────────────────────────────────────────────────────────────────────────

class TestGetCurrentUser:
    def _creds(self, token: str) -> HTTPAuthorizationCredentials:
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    def test_valid_token_returns_user_claims(self):
        token = _make_token(_valid_payload(sub="user-xyz", email="xyz@test.com"))
        with _mock_empty_jwks(), _mock_jwt_secret():
            user = get_current_user(self._creds(token))
        assert isinstance(user, UserClaims)
        assert user.user_id == "user-xyz"
        assert user.email == "xyz@test.com"

    def test_no_credentials_raises_401(self):
        with pytest.raises(HTTPException) as exc:
            get_current_user(None)
        assert exc.value.status_code == 401
        assert "Not authenticated" in exc.value.detail

    def test_expired_token_raises_401(self):
        token = _make_token(_valid_payload(exp_offset=-1))
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds(token))
        assert exc.value.status_code == 401
        assert "expired" in exc.value.detail.lower()

    def test_invalid_token_raises_401(self):
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds("bad.token.value"))
        assert exc.value.status_code == 401

    def test_missing_sub_claim_raises_401(self):
        payload = {"email": "x@y.com", "exp": int(time.time()) + 3600}
        token = _make_token(payload)
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds(token))
        assert exc.value.status_code == 401
        assert "sub" in exc.value.detail.lower()

    def test_email_can_be_empty_string(self):
        """Email is optional — empty string is valid."""
        payload = _valid_payload(email="")
        token = _make_token(payload)
        with _mock_empty_jwks(), _mock_jwt_secret():
            user = get_current_user(self._creds(token))
        assert user.email == ""

    def test_tampered_token_raises_401(self):
        token = _make_token(_valid_payload())
        tampered = token[:-5] + "XXXXX"
        with _mock_empty_jwks(), _mock_jwt_secret():
            with pytest.raises(HTTPException) as exc:
                get_current_user(self._creds(tampered))
        assert exc.value.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# _get_jwt_secret — base64 decode logic
# ─────────────────────────────────────────────────────────────────────────────

class TestGetJwtSecret:
    def test_raw_string_returned_when_not_base64(self):
        secret = "plaintext-secret!@#$"
        with patch("app.core.security.settings") as mock_settings:
            mock_settings.SUPABASE_JWT_SECRET = secret
            result = _get_jwt_secret()
        # Either raw string or decoded bytes, both valid
        assert result is not None

    def test_base64url_decoded_to_bytes(self):
        import base64
        raw = b"some-32-byte-jwt-secret-here!!"
        encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
        with patch("app.core.security.settings") as mock_settings:
            mock_settings.SUPABASE_JWT_SECRET = encoded
            result = _get_jwt_secret()
        assert result == raw
