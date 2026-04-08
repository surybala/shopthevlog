"""
rate_limit.py — Inbound rate limiting for shopthevlog.

  slowapi limiter that protects our own API endpoints.
  Keyed by JWT user-id for authenticated requests; falls
  back to client IP for anonymous traffic.
  Backend: Redis (settings.REDIS_URL).

Usage
-----
  # In a route handler:
  from app.core.rate_limit import limiter, SEARCH_LIMIT

  @router.post("/search")
  @limiter.limit(SEARCH_LIMIT)
  async def search(request: Request, ...): ...
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

SEARCH_LIMIT = "20/minute"

# ─── Inbound limiter (slowapi) ────────────────────────────────────────────────


def _get_user_or_ip(request: Request) -> str:
    """Key function for slowapi.

    Uses the JWT ``sub`` claim (user-id) when present so limits are per-user
    rather than per-IP (important for users behind shared IPs / NAT / proxies).
    Falls back to client IP for unauthenticated endpoints.
    """
    # Try to extract user id from a previously-decoded token that middleware
    # may have stashed in request.state.
    user_id: Optional[str] = getattr(getattr(request, "state", None), "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address(request)


def _resolve_storage_uri() -> str:
    """Return the configured Redis URL if Redis is reachable, else fall back to
    in-process memory storage so the app starts even when Redis isn't running."""
    try:
        import redis as _redis

        client = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        client.ping()
        client.close()
        logger.info("Redis reachable at %s — using Redis for rate-limit storage", settings.REDIS_URL)
        return settings.REDIS_URL
    except Exception as exc:
        logger.warning(
            "Redis not reachable (%s) — falling back to in-memory rate-limit storage. "
            "Rate limits will NOT be shared across workers.",
            exc,
        )
        return "memory://"


limiter = Limiter(
    key_func=_get_user_or_ip,
    storage_uri=_resolve_storage_uri(),
    enabled=True,
)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Return a JSON 429 instead of the default plain-text slowapi response."""
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=429,
        content={
            "detail": f"Rate limit exceeded: {exc.detail}. Please wait before retrying."
        },
    )
