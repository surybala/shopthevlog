"""
Shared pytest fixtures for the shopthevlog backend test suite.

Sets environment variables *before* any app module is imported so that
pydantic-settings resolves them correctly at Settings() instantiation time.
"""
import os

# ── Must be set before any `from app.xxx import ...` happens ─────────────────
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-long-enough-for-hmac-256-bits!!")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("DUFFEL_ACCESS_TOKEN", "test-duffel-token")
os.environ.setdefault("LITEAPI_API_KEY", "test-liteapi-key")
# Use in-process memory backend so slowapi rate limiting works without Redis in tests.
os.environ.setdefault("REDIS_URL", "memory://")

from unittest.mock import MagicMock
import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Disable rate limiting globally so repeated test requests don't hit 429
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def disable_rate_limits():
    """Turn off slowapi for every test.  Rate-limit logic is tested separately."""
    from app.core.rate_limit import limiter
    # slowapi stores the flag as `enabled` (public attribute)
    original = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = original


# ─────────────────────────────────────────────────────────────────────────────
# Supabase mock factory
# ─────────────────────────────────────────────────────────────────────────────

def _make_table_mock(default_data=None):
    """
    Build a chainable MagicMock that satisfies the Supabase Python client API:
        db.table("x").select("*").eq("col","val").execute() → MagicMock(data=[...])
    """
    table = MagicMock()
    execute_result = MagicMock(data=default_data or [])

    for method in (
        "select", "eq", "neq", "in_", "order", "limit", "lt", "gt",
        "update", "insert", "upsert", "delete", "single", "filter",
    ):
        getattr(table, method).return_value = table

    table.execute.return_value = execute_result
    return table, execute_result


@pytest.fixture
def mock_supabase():
    """
    A MagicMock Supabase client.  Each call to `.table()` returns the *same*
    chainable table mock so callers can configure `execute.return_value` easily.
    """
    client = MagicMock()
    table, _ = _make_table_mock()
    client.table.return_value = table
    return client


@pytest.fixture
def supabase_table_factory():
    """
    Returns a helper that creates independent table mocks with specific data.
    Useful when a function does multiple `.table(...)` calls with different results.
    """
    def factory(data=None):
        table, result = _make_table_mock(data)
        result.data = data or []
        return table, result
    return factory
