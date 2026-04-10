import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.observability import observability_store
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.core.sentry import init_sentry
from app.api.v1.router import api_router

logging.basicConfig(level=logging.DEBUG)
init_sentry()

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


@app.middleware("http")
async def record_http_observability(request, call_next):
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        observability_store.record(
            kind="http",
            name=request.url.path,
            status="error",
            duration_ms=(time.perf_counter() - started_at) * 1000,
            detail=type(exc).__name__,
        )
        raise

    observability_store.record(
        kind="http",
        name=request.url.path,
        status=str(response.status_code),
        duration_ms=(time.perf_counter() - started_at) * 1000,
    )
    return response

# Routes
app.include_router(api_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "env": settings.APP_ENV,
        "oauthlib_insecure_transport": os.environ.get("OAUTHLIB_INSECURE_TRANSPORT", "NOT SET"),
    }


@app.get("/health/metrics")
async def health_metrics():
    return observability_store.snapshot()
