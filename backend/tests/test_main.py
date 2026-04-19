"""
Tests for app.main — health endpoint, lifespan startup, and app wiring.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.core.observability import observability_store


def _get_client() -> TestClient:
    from app.main import app
    return TestClient(app, raise_server_exceptions=False)


class TestHealthEndpoint:
    def setup_method(self):
        observability_store.reset()

    def test_returns_200(self):
        client = _get_client()
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_returns_ok_status(self):
        client = _get_client()
        resp = client.get("/health")
        assert resp.json()["status"] == "ok"

    def test_returns_env_field(self):
        client = _get_client()
        resp = client.get("/health")
        data = resp.json()
        assert "env" in data

    def test_returns_oauthlib_field(self):
        client = _get_client()
        resp = client.get("/health")
        data = resp.json()
        assert "oauthlib_insecure_transport" in data

    def test_env_matches_settings(self):
        from app.core.config import settings
        client = _get_client()
        resp = client.get("/health")
        assert resp.json()["env"] == settings.APP_ENV

    def test_health_metrics_returns_observability_snapshot(self):
        observability_store.record(kind="http", name="/health", status="200", duration_ms=12.5)

        client = _get_client()
        resp = client.get("/health/metrics")

        assert resp.status_code == 200
        data = resp.json()
        assert "metrics" in data
        assert data["metrics"]


class TestCorsMiddleware:
    def test_cors_middleware_is_attached(self):
        """CORSMiddleware should be present in the middleware stack."""
        from app.main import app
        from starlette.middleware.cors import CORSMiddleware
        middleware_types = [type(m) for m in app.user_middleware]
        # FastAPI wraps middlewares — check the class names
        cls_names = [m.cls.__name__ if hasattr(m, "cls") else type(m).__name__
                     for m in app.user_middleware]
        assert "CORSMiddleware" in cls_names

    def test_health_returns_200_regardless_of_origin(self):
        """Basic sanity: health is accessible."""
        client = _get_client()
        resp = client.get("/health")
        assert resp.status_code == 200
class TestLifespan:
    def test_jwks_prewarmed_on_startup(self):
        """lifespan should call _jwks() to pre-warm the JWKS cache."""
        from app.main import app

        with patch("app.core.security._jwks") as mock_jwks:
            mock_jwks.return_value = {"keys": []}
            with TestClient(app):
                pass  # enters and exits lifespan

        mock_jwks.assert_called()

    def test_startup_continues_even_if_jwks_fails(self):
        """A JWKS fetch failure on startup should not crash the app."""
        from app.main import app

        with patch("app.core.security._jwks", side_effect=Exception("network error")):
            # Should not raise
            with TestClient(app):
                resp = TestClient(app).get("/health")
            assert resp.status_code == 200


class TestApiRouterMounted:
    def test_vlogs_route_exists(self):
        client = _get_client()
        resp = client.get("/api/v1/vlogs")
        assert resp.status_code in (401, 403, 422)

    def test_webhooks_route_exists(self):
        client = _get_client()
        resp = client.post("/api/v1/webhooks/scan/trigger")
        assert resp.status_code in (401, 403, 422)

    def test_unknown_route_returns_404(self):
        client = _get_client()
        resp = client.get("/this-does-not-exist")
        assert resp.status_code == 404
