"""
rate_limit.py — Two-tier rate limiting for shopthevlog.

  Part A (inbound)  – slowapi limiter that protects our own API endpoints.
                      Keyed by JWT user-id for authenticated requests; falls
                      back to client IP for anonymous traffic.
                      Backend: Redis (settings.REDIS_URL).

  Part B (outbound) – Async token-bucket singletons, one per external service.
                      Each service function calls ``await <bucket>.acquire()``
                      before making an HTTP request, ensuring we never exceed
                      the external provider's published rate limits even when
                      many concurrent requests arrive at once.

Usage
-----
  # In a route handler:
  from app.core.rate_limit import limiter, SEARCH_LIMIT, BOOKING_LIMIT

  @router.post("/search")
  @limiter.limit(SEARCH_LIMIT)
  async def search(request: Request, ...): ...

  # In a service function:
  from app.core.rate_limit import booking_com_bucket

  async def search_hotels(...):
      await booking_com_bucket.acquire()
      async with httpx.AsyncClient() as client:
          ...
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

SEARCH_LIMIT = "20/minute"
BOOKING_LIMIT = "5/minute"

# ─── Part A: Inbound limiter (slowapi) ────────────────────────────────────────


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


# ─── Part B: Outbound token bucket ───────────────────────────────────────────


class _AsyncTokenBucket:
    """Thread-safe async token bucket for rate-limiting outbound HTTP calls.

    ``acquire()`` refills tokens based on elapsed time then either consumes
    one token immediately or sleeps until a token is available.  This
    guarantees the long-run average call rate never exceeds ``rate_rpm`` while
    still allowing short bursts up to ``capacity``.

    Args:
        rate_rpm:  Maximum average calls per minute.
        capacity:  Maximum burst size (tokens; defaults to ``rate_rpm``).
    """

    def __init__(self, rate_rpm: int, capacity: Optional[int] = None) -> None:
        self._rate_per_s: float = rate_rpm / 60.0
        self._capacity: float = float(capacity if capacity is not None else rate_rpm)
        self._tokens: float = self._capacity
        self._last_refill: float = time.monotonic()
        self._lock: asyncio.Lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Block until a token is available, then consume it."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            # Refill tokens proportional to elapsed time.
            self._tokens = min(
                self._capacity,
                self._tokens + elapsed * self._rate_per_s,
            )
            self._last_refill = now

            if self._tokens >= 1.0:
                self._tokens -= 1.0
            else:
                # Wait until one full token is available.
                wait_s = (1.0 - self._tokens) / self._rate_per_s
                logger.debug(
                    "Token bucket dry — sleeping %.2fs before outbound call", wait_s
                )
                await asyncio.sleep(wait_s)
                self._tokens = 0.0


# One bucket per external service.  Add new ones here as integrations grow.
booking_com_bucket = _AsyncTokenBucket(settings.BOOKING_COM_RATE_LIMIT_RPM)
