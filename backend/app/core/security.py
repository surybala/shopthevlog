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
# JWKS cache — fetched once per process from Supabase's well-known endpoint.
# Supabase now signs JWTs with ES256/RS256 via rotating JWT Signing Keys.
# The JWKS endpoint publishes the current public keys; python-jose resolves
# the correct key automatically using the token's `kid` header claim.
# ---------------------------------------------------------------------------
_JWKS: dict | None = None


def _jwks() -> dict:
    global _JWKS
    if _JWKS is None:
        url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        _JWKS = resp.json()
        logger.info("Loaded %d key(s) from Supabase JWKS", len(_JWKS.get("keys", [])))
    return _JWKS


def _reset_jwks_cache() -> None:
    """Force a JWKS refresh on the next verification — used after a 401 to
    handle key rotation transparently without a process restart."""
    global _JWKS
    _JWKS = None


# ---------------------------------------------------------------------------
# Token verification — ES256/RS256 via JWKS only (legacy HS256 removed)
# ---------------------------------------------------------------------------
def _verify_token(token: str) -> dict:
    """
    Verify a Supabase JWT using the project's JWKS endpoint (ES256 / RS256).

    On a first-time 401 the JWKS cache is cleared and the request is retried
    once — this handles transparent key rotation without a process restart.
    """
    for attempt in range(2):
        jwks = _jwks()
        try:
            payload = jwt.decode(
                token,
                jwks,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
            logger.debug("Token verified via JWKS (attempt %d)", attempt + 1)
            return payload
        except ExpiredSignatureError:
            raise  # definitive — no point retrying
        except JWTError as e:
            if attempt == 0:
                # Key may have rotated — bust the cache and retry once
                logger.info("JWKS verification failed (%s), refreshing cache and retrying", e)
                _reset_jwks_cache()
            else:
                raise


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
