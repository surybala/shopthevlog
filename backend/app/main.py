import base64
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.api.v1.router import api_router

logging.basicConfig(level=logging.DEBUG)

# Allow Google OAuth over plain HTTP in local development.
# google-auth-oauthlib rejects non-HTTPS redirect URIs unless this is set.
if settings.APP_ENV == "development":
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm on startup so the first real request doesn't pay the cold-start cost.
    try:
        from app.core.security import _jwks
        _jwks()
        logger.info("JWKS pre-fetched on startup")
    except Exception as e:
        logger.warning("JWKS pre-fetch failed: %s", e)

    try:
        from app.db.client import get_supabase
        get_supabase()
        logger.info("Supabase client initialised on startup")
    except Exception as e:
        logger.warning("Supabase client init failed: %s", e)

    yield


app = FastAPI(
    title="shopthevlog API",
    description="Travel vlog discovery and trip booking platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.APP_ENV == "development" else None,
    redoc_url=None,
)

# Rate limiting — attach limiter state and 429 handler.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(api_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "env": settings.APP_ENV,
        "oauthlib_insecure_transport": os.environ.get("OAUTHLIB_INSECURE_TRANSPORT", "NOT SET"),
    }


@app.get("/debug-auth")
async def debug_auth(request: Request):
    """
    Temporary debug endpoint — remove before production.
    Shows exactly what token the backend is receiving and which verification path succeeds.
    """
    auth_header = request.headers.get("Authorization", "")

    if not auth_header:
        return {"error": "No Authorization header received"}

    if not auth_header.startswith("Bearer "):
        return {"error": f"Unexpected format: {auth_header[:30]}"}

    token = auth_header.split(" ", 1)[1]

    # Decode JWT header + claims without verification (just to inspect)
    parts = token.split(".")
    if len(parts) != 3:
        return {"error": "Malformed JWT — not 3 parts"}

    try:
        padded_header = parts[0] + "=" * (-len(parts[0]) % 4)
        header = json.loads(base64.urlsafe_b64decode(padded_header))
    except Exception as e:
        header = {"error": str(e)}

    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except Exception as e:
        return {"error": f"Could not decode claims: {e}"}

    from jose import jwt as jose_jwt, JWTError
    from app.core.security import _jwt_secret, _jwks

    # Try RS256 via JWKS
    jwks = _jwks()
    rs256_verified = False
    rs256_error = None
    if jwks.get("keys"):
        try:
            jose_jwt.decode(token, jwks, algorithms=["ES256", "RS256"], options={"verify_aud": False})
            rs256_verified = True
        except JWTError as e:
            rs256_error = str(e)
    else:
        rs256_error = "No JWKS keys loaded"

    # Try HS256 via legacy secret
    secret = _jwt_secret()
    hs256_verified = False
    hs256_error = None
    try:
        jose_jwt.decode(token, secret, algorithms=["HS256"], options={"verify_aud": False})
        hs256_verified = True
    except JWTError as e:
        hs256_error = str(e)

    return {
        "token_received": True,
        "token_preview": token[:40] + "...",
        "jwt_header": header,
        "claims": {
            "sub": claims.get("sub"),
            "email": claims.get("email"),
            "role": claims.get("role"),
            "aud": claims.get("aud"),
            "exp": claims.get("exp"),
            "iss": claims.get("iss"),
        },
        "jwks_keys_loaded": len(jwks.get("keys", [])),
        "rs256_verified": rs256_verified,
        "rs256_error": rs256_error,
        "hs256_secret_type": "bytes" if isinstance(secret, bytes) else "str",
        "hs256_secret_length": len(secret),
        "hs256_verified": hs256_verified,
        "hs256_error": hs256_error,
        "overall_result": "✅ verified" if (rs256_verified or hs256_verified) else "❌ failed",
    }
