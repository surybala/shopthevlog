"""
Shared pytest fixtures for the VlogShopper backend test suite.

Environment variables are set BEFORE any app module is imported so that
pydantic-settings resolves them correctly at Settings() instantiation time.
"""
import os

# ── Must be set before any `from app.xxx import ...` ────────────────────────
os.environ.setdefault("SUPABASE_URL",            "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET",     "test-jwt-secret-long-enough-for-hmac-256-bits!!")
os.environ.setdefault("DATABASE_URL",            "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("GEMINI_API_KEY",          "test-gemini-key")
# Use in-process memory backend so slowapi rate limiting works without Redis.
os.environ.setdefault("REDIS_URL",               "memory://")

from contextlib import contextmanager
from unittest.mock import MagicMock, patch
import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Silence the gotrue __del__ bug
#
# gotrue is deprecated (supabase-py bundles supabase_auth in newer versions).
# The installed version has a bug: SyncGoTrueClient.__del__ accesses
# self._refresh_token_timer before __init__ sets it, so Python prints a noisy
# "Exception ignored" traceback to stderr on every test teardown.
#
# This patch replaces __del__ with a no-op so the output is clean.
# Remove once supabase-py is upgraded to >=2.7.0 (which drops gotrue).
# ─────────────────────────────────────────────────────────────────────────────
import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    try:
        from gotrue._sync.gotrue_client import SyncGoTrueClient
        SyncGoTrueClient.__del__ = lambda self: None
    except (ImportError, AttributeError):
        pass
    try:
        from gotrue._async.gotrue_client import AsyncGoTrueClient
        AsyncGoTrueClient.__del__ = lambda self: None
    except (ImportError, AttributeError):
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Rate limiting — disable globally; tested separately
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def disable_rate_limits():
    """Turn off slowapi for every test."""
    try:
        from app.core.rate_limit import limiter
        original = limiter.enabled
        limiter.enabled = False
        yield
        limiter.enabled = original
    except Exception:
        yield


# ─────────────────────────────────────────────────────────────────────────────
# PgClient mock
# ─────────────────────────────────────────────────────────────────────────────

class FakeCursor:
    """Minimal psycopg2 RealDictCursor stand-in."""

    def __init__(self):
        self._rows: list[dict] = []
        self.queries: list[tuple] = []      # (sql, params) log for assertions

    def execute(self, sql: str, params=None):
        self.queries.append((sql, params))

    def fetchone(self) -> dict | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[dict]:
        return list(self._rows)

    def set_rows(self, rows: list[dict]):
        """Pre-load rows that fetchone / fetchall will return."""
        self._rows = rows

    def close(self):
        pass


class FakeConn:
    def commit(self):   pass
    def rollback(self): pass
    def close(self):    pass


class FakePgClient:
    """
    Drop-in replacement for app.db.pg_client.PgClient.

    Usage in tests:
        client = FakePgClient()
        client.cursor.set_rows([{"id": "abc", "processingStatus": "PENDING"}])
        with patch("app.services.gemini_service.PgClient", return_value=client):
            ...

    Because PgClient is used as a context manager (`with PgClient() as db:`),
    this class implements __enter__ / __exit__ and returns itself.
    """

    def __init__(self, rows: list[dict] | None = None):
        self.cursor = FakeCursor()
        if rows:
            self.cursor.set_rows(rows)
        self.conn = FakeConn()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()

    def execute(self, sql: str, params=None):
        self.cursor.execute(sql, params)

    def fetchone(self) -> dict | None:
        return self.cursor.fetchone()

    def fetchall(self) -> list[dict]:
        return self.cursor.fetchall()

    def set_rows(self, rows: list[dict]):
        self.cursor.set_rows(rows)


@pytest.fixture
def fake_pg():
    """Return a fresh FakePgClient for each test."""
    return FakePgClient()


@pytest.fixture
def mock_pg_client(fake_pg):
    """
    Patch app.db.pg_client.PgClient everywhere with the FakePgClient class.
    Yields the FakePgClient instance so tests can configure rows and inspect queries.
    """
    # We need PgClient() to return our fake instance, so we patch the class
    # with a callable that always returns the same fake object.
    patcher = patch("app.db.pg_client.PgClient", return_value=fake_pg)
    patcher.start()
    yield fake_pg
    patcher.stop()
