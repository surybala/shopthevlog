import base64
import logging
from dataclasses import dataclass

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# JWKS cache — fetched once per process from Supabase's well-known endpoint
# ---------------------------------------------------------------------------
_JWKS: dict | None = None


def _jwks() -> dict:
    global _JWKS
    if _JWKS is None:
        url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        try:
            resp = httpx.get(url, timeout=10)
            resp.raise_for_status()
            _JWKS = resp.json()
            logger.info("Loaded %d key(s) from Supabase JWKS", len(_JWKS.get("keys", [])))
        except Exception as e:
            logger.warning("Could not fetch JWKS: %s — will use legacy HS256 secret", e)
            _JWKS = {"keys": []}
    return _JWKS


# ---------------------------------------------------------------------------
# Legacy HS256 secret (fallback for projects not yet on new signing keys)
# ---------------------------------------------------------------------------
def _get_jwt_secret() -> str | bytes:
    secret = settings.SUPABASE_JWT_SECRET
    try:
        padded = secret + "=" * (-len(secret) % 4)
        decoded = base64.urlsafe_b64decode(padded)
        logger.debug("JWT secret decoded from base64url (%d bytes)", len(decoded))
        return decoded
    except Exception as e:
        logger.debug("base64 decode failed (%s), using raw secret string", e)
        return secret


_JWT_SECRET: str | bytes | None = None


def _jwt_secret() -> str | bytes:
    global _JWT_SECRET
    if _JWT_SECRET is None:
        _JWT_SECRET = _get_jwt_secret()
    return _JWT_SECRET


# ---------------------------------------------------------------------------
# Token verification — ES256/RS256 (JWKS) with HS256 fallback
# ---------------------------------------------------------------------------
def _verify_token(token: str) -> dict:
    """
    Try ES256/RS256 via Supabase JWKS first (new JWT Signing Keys),
    fall back to HS256 legacy secret.
    """
    # ── 1. JWKS (ES256 / RS256) ───────────────────────────────────────────
    jwks = _jwks()
    if jwks.get("keys"):
        try:
            payload = jwt.decode(
                token,
                jwks,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
            logger.debug("Token verified via JWKS")
            return payload
        except ExpiredSignatureError:
            raise  # definitive — don't fall through to HS256
        except Exception as e:
            logger.debug("JWKS verification failed (%s), trying HS256 legacy", e)

    # ── 2. HS256 legacy secret ────────────────────────────────────────────
    payload = jwt.decode(
        token,
        _jwt_secret(),
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    logger.debug("Token verified via HS256 legacy secret")
    return payload


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
@dataclass
class UserClaims:
    user_id: str
    email: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserClaims:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    token = credentials.credentials
    try:
        payload = _verify_token(token)
        user_id: str = payload.get("sub", "")
        email: str = payload.get("email", "")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing sub claim",
            )
        return UserClaims(user_id=user_id, email=email)
    except HTTPException:
        raise
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except JWTError as e:
        logger.warning("JWT decode failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    except Exception as e:
        logger.error("Unexpected auth error: %s: %s", type(e).__name__, e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification error: {type(e).__name__}",
        )
