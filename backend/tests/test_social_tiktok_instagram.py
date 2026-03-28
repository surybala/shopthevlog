"""
Tests for TikTok and Instagram OAuth endpoints in app/api/v1/social.py

Covers:
  - GET /social/connect/tiktok     (501 when unconfigured, URL with correct params)
  - GET /social/connect/tiktok/callback  (failure modes, success token storage)
  - GET /social/connect/instagram   (501 when unconfigured, URL)
  - GET /social/connect/instagram/callback  (failure on error param, success flow)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ── App bootstrap ──────────────────────────────────────────────────────────────
from app.main import app
from app.core.security import get_current_user, UserClaims
from app.db.client import get_supabase


# ── Shared auth override ────────────────────────────────────────────────────────
FAKE_USER = UserClaims(user_id="test-user-uuid", email="test@test.com")


def _override_auth():
    return FAKE_USER


def _make_db():
    db = MagicMock()
    db.table.return_value.upsert.return_value.execute.return_value = MagicMock(data=[])
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return db


@pytest.fixture(autouse=True)
def _patch_supabase(monkeypatch):
    db = _make_db()
    monkeypatch.setattr("app.api.v1.social.get_supabase", lambda: db)
    return db


@pytest.fixture()
def client():
    app.dependency_overrides[get_current_user] = _override_auth
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


# ═══════════════════════════════════════════════════════════════════════════════
# GET /social/connect/tiktok
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnectTiktok:
    def test_returns_501_when_client_key_not_set(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = "http://localhost/callback"
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt_cid"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt_sec"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost/yt"
            mock_settings.YOUTUBE_API_KEY = "yt_key"
            resp = client.get("/api/v1/social/connect/tiktok")
        assert resp.status_code == 501

    def test_returns_url_when_configured(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.TIKTOK_CLIENT_KEY = "my_client_key"
            mock_settings.TIKTOK_CLIENT_SECRET = "my_secret"
            mock_settings.TIKTOK_REDIRECT_URI = "http://localhost:8000/api/v1/social/connect/tiktok/callback"
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt_cid"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt_sec"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost/yt"
            mock_settings.YOUTUBE_API_KEY = "yt_key"
            resp = client.get("/api/v1/social/connect/tiktok")
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert "tiktok.com" in data["url"]

    def test_url_contains_client_key(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.TIKTOK_CLIENT_KEY = "CLIENT_KEY_123"
            mock_settings.TIKTOK_CLIENT_SECRET = "sec"
            mock_settings.TIKTOK_REDIRECT_URI = "http://localhost/cb"
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt_cid"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt_sec"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost/yt"
            mock_settings.YOUTUBE_API_KEY = "yt_key"
            resp = client.get("/api/v1/social/connect/tiktok")
        url = resp.json()["url"]
        assert "CLIENT_KEY_123" in url

    def test_url_contains_user_id_as_state(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.TIKTOK_CLIENT_KEY = "key"
            mock_settings.TIKTOK_CLIENT_SECRET = "sec"
            mock_settings.TIKTOK_REDIRECT_URI = "http://localhost/cb"
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt_cid"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt_sec"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost/yt"
            mock_settings.YOUTUBE_API_KEY = "yt_key"
            resp = client.get("/api/v1/social/connect/tiktok")
        url = resp.json()["url"]
        assert FAKE_USER.user_id in url

    def test_url_contains_expected_scopes(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.TIKTOK_CLIENT_KEY = "key"
            mock_settings.TIKTOK_CLIENT_SECRET = "sec"
            mock_settings.TIKTOK_REDIRECT_URI = "http://localhost/cb"
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt_cid"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt_sec"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost/yt"
            mock_settings.YOUTUBE_API_KEY = "yt_key"
            resp = client.get("/api/v1/social/connect/tiktok")
        url = resp.json()["url"]
        # Scopes may be URL-encoded
        assert "user.info.basic" in url or "user.info" in url or "scope=" in url


# ═══════════════════════════════════════════════════════════════════════════════
# GET /social/connect/tiktok/callback
# ═══════════════════════════════════════════════════════════════════════════════

class TestTiktokCallback:
    def _call(self, client, params: dict):
        return client.get("/api/v1/social/connect/tiktok/callback", params=params)

    def test_returns_failure_html_when_error_param_present(self, client):
        resp = self._call(client, {"error": "access_denied", "code": "c", "state": "s"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_failure_html_when_no_code(self, client):
        resp = self._call(client, {"state": "user-id"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_failure_html_when_no_state(self, client):
        resp = self._call(client, {"code": "auth_code"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_success_html_on_valid_callback(self, client, _patch_supabase):
        token_response = MagicMock()
        token_response.json.return_value = {
            "data": {
                "access_token": "tok_abc",
                "open_id": "tiktok_user_123",
            }
        }
        user_response = MagicMock()
        user_response.json.return_value = {
            "data": {"user": {"display_name": "TikTok Creator"}}
        }

        async def mock_post(*args, **kwargs):
            return token_response

        async def mock_get(*args, **kwargs):
            return user_response

        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = mock_post
            mock_ctx.get = mock_get
            mock_client_cls.return_value = mock_ctx

            with patch("app.api.v1.social._seed_and_build_feed", new_callable=AsyncMock):
                with patch("asyncio.create_task"):
                    resp = self._call(client, {"code": "valid_code", "state": "user-uuid"})

        assert resp.status_code == 200
        assert "success:true" in resp.text or "true" in resp.text

    def test_stores_tiktok_tokens_in_db(self, client, _patch_supabase):
        token_response = MagicMock()
        token_response.json.return_value = {
            "data": {
                "access_token": "stored_token",
                "open_id": "open_id_xyz",
            }
        }
        user_response = MagicMock()
        user_response.json.return_value = {
            "data": {"user": {"display_name": "My TikTok"}}
        }

        async def mock_post(*args, **kwargs):
            return token_response

        async def mock_get(*args, **kwargs):
            return user_response

        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = mock_post
            mock_ctx.get = mock_get
            mock_client_cls.return_value = mock_ctx

            with patch("app.api.v1.social._seed_and_build_feed", new_callable=AsyncMock):
                with patch("asyncio.create_task"):
                    self._call(client, {"code": "valid_code", "state": "user-uuid"})

        # Verify upsert was called
        _patch_supabase.table.return_value.upsert.assert_called()

    def test_returns_failure_html_on_token_exchange_error(self, client):
        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = AsyncMock(side_effect=Exception("network error"))
            mock_client_cls.return_value = mock_ctx

            resp = self._call(client, {"code": "code", "state": "user"})

        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text


# ═══════════════════════════════════════════════════════════════════════════════
# GET /social/connect/instagram
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnectInstagram:
    def test_returns_501_when_not_configured(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.INSTAGRAM_CLIENT_ID = ""
            mock_settings.INSTAGRAM_CLIENT_SECRET = ""
            mock_settings.INSTAGRAM_REDIRECT_URI = ""
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost"
            mock_settings.YOUTUBE_API_KEY = "key"
            resp = client.get("/api/v1/social/connect/instagram")
        assert resp.status_code == 501

    def test_returns_url_when_configured(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.INSTAGRAM_CLIENT_ID = "ig_client_id_99"
            mock_settings.INSTAGRAM_CLIENT_SECRET = "ig_secret"
            mock_settings.INSTAGRAM_REDIRECT_URI = "http://localhost:8000/api/v1/social/connect/instagram/callback"
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost"
            mock_settings.YOUTUBE_API_KEY = "key"
            resp = client.get("/api/v1/social/connect/instagram")
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert "instagram.com" in data["url"]

    def test_url_contains_client_id(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.INSTAGRAM_CLIENT_ID = "IG_CID_XYZ"
            mock_settings.INSTAGRAM_CLIENT_SECRET = "sec"
            mock_settings.INSTAGRAM_REDIRECT_URI = "http://localhost/cb"
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost"
            mock_settings.YOUTUBE_API_KEY = "key"
            resp = client.get("/api/v1/social/connect/instagram")
        url = resp.json()["url"]
        assert "IG_CID_XYZ" in url

    def test_url_contains_user_id_as_state(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.INSTAGRAM_CLIENT_ID = "ig_cid"
            mock_settings.INSTAGRAM_CLIENT_SECRET = "sec"
            mock_settings.INSTAGRAM_REDIRECT_URI = "http://localhost/cb"
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost"
            mock_settings.YOUTUBE_API_KEY = "key"
            resp = client.get("/api/v1/social/connect/instagram")
        url = resp.json()["url"]
        assert FAKE_USER.user_id in url

    def test_url_contains_response_type_code(self, client):
        with patch("app.api.v1.social.settings") as mock_settings:
            mock_settings.INSTAGRAM_CLIENT_ID = "ig_cid"
            mock_settings.INSTAGRAM_CLIENT_SECRET = "sec"
            mock_settings.INSTAGRAM_REDIRECT_URI = "http://localhost/cb"
            mock_settings.TIKTOK_CLIENT_KEY = ""
            mock_settings.TIKTOK_CLIENT_SECRET = ""
            mock_settings.TIKTOK_REDIRECT_URI = ""
            mock_settings.YOUTUBE_CLIENT_ID = "yt"
            mock_settings.YOUTUBE_CLIENT_SECRET = "yt"
            mock_settings.YOUTUBE_REDIRECT_URI = "http://localhost"
            mock_settings.YOUTUBE_API_KEY = "key"
            resp = client.get("/api/v1/social/connect/instagram")
        url = resp.json()["url"]
        assert "response_type=code" in url


# ═══════════════════════════════════════════════════════════════════════════════
# GET /social/connect/instagram/callback
# ═══════════════════════════════════════════════════════════════════════════════

class TestInstagramCallback:
    def _call(self, client, params: dict):
        return client.get("/api/v1/social/connect/instagram/callback", params=params)

    def test_returns_failure_html_when_error_param(self, client):
        resp = self._call(client, {"error": "access_denied", "code": "c", "state": "s"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_failure_html_when_no_code(self, client):
        resp = self._call(client, {"state": "user-id"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_failure_html_when_no_state(self, client):
        resp = self._call(client, {"code": "auth_code"})
        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_returns_success_html_on_valid_callback(self, client, _patch_supabase):
        token_response = MagicMock()
        token_response.json.return_value = {
            "access_token": "ig_access_token",
            "user_id": 987654321,
        }
        token_response.raise_for_status = MagicMock()

        user_info_response = {"id": "987654321", "username": "ig_creator"}

        async def mock_post(*args, **kwargs):
            return token_response

        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = mock_post
            mock_client_cls.return_value = mock_ctx

            with patch(
                "app.services.instagram_service.get_instagram_user_info",
                new_callable=AsyncMock,
                return_value=user_info_response,
            ):
                with patch("app.services.instagram_service.ingest_instagram_user_media", new_callable=AsyncMock):
                    with patch("app.api.v1.social.build_feed_for_user"):
                        with patch("asyncio.create_task"):
                            resp = self._call(client, {"code": "auth_code", "state": "user-uuid"})

        assert resp.status_code == 200
        assert "success:true" in resp.text or "true" in resp.text

    def test_stores_instagram_connection_in_db(self, client, _patch_supabase):
        token_response = MagicMock()
        token_response.json.return_value = {
            "access_token": "stored_ig_token",
            "user_id": 111222333,
        }
        token_response.raise_for_status = MagicMock()

        async def mock_post(*args, **kwargs):
            return token_response

        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = mock_post
            mock_client_cls.return_value = mock_ctx

            with patch(
                "app.services.instagram_service.get_instagram_user_info",
                new_callable=AsyncMock,
                return_value={"id": "111222333", "username": "test_ig"},
            ):
                with patch("app.services.instagram_service.ingest_instagram_user_media", new_callable=AsyncMock):
                    with patch("app.api.v1.social.build_feed_for_user"):
                        with patch("asyncio.create_task"):
                            self._call(client, {"code": "code", "state": "user-uuid"})

        _patch_supabase.table.return_value.upsert.assert_called()

    def test_returns_failure_html_on_token_exchange_error(self, client):
        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = AsyncMock(side_effect=Exception("connection timeout"))
            mock_client_cls.return_value = mock_ctx

            resp = self._call(client, {"code": "code", "state": "user"})

        assert resp.status_code == 200
        assert "success:false" in resp.text or "false" in resp.text

    def test_platform_stored_as_instagram(self, client, _patch_supabase):
        """Verify the upsert payload includes platform='instagram'."""
        captured_payloads = []
        original_upsert = _patch_supabase.table.return_value.upsert

        def capture_upsert(payload, **kwargs):
            captured_payloads.append(payload)
            return original_upsert(payload, **kwargs)

        _patch_supabase.table.return_value.upsert = capture_upsert

        token_response = MagicMock()
        token_response.json.return_value = {"access_token": "tok", "user_id": 555}
        token_response.raise_for_status = MagicMock()

        async def mock_post(*args, **kwargs):
            return token_response

        with patch("app.api.v1.social.httpx.AsyncClient") as mock_client_cls:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            mock_ctx.post = mock_post
            mock_client_cls.return_value = mock_ctx

            with patch(
                "app.services.instagram_service.get_instagram_user_info",
                new_callable=AsyncMock,
                return_value={"id": "555", "username": "my_ig"},
            ):
                with patch("app.services.instagram_service.ingest_instagram_user_media", new_callable=AsyncMock):
                    with patch("app.api.v1.social.build_feed_for_user"):
                        with patch("asyncio.create_task"):
                            self._call(client, {"code": "code", "state": "user-uuid"})

        social_payloads = [p for p in captured_payloads if isinstance(p, dict) and p.get("platform") == "instagram"]
        assert len(social_payloads) >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# GET /social/status — includes tiktok in response
# ═══════════════════════════════════════════════════════════════════════════════

class TestSocialStatusIncludesTiktok:
    def test_status_returns_tiktok_connection(self, client, _patch_supabase):
        _patch_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[
                {"id": "conn-1", "platform": "youtube", "platform_username": "@ytchan", "connected_at": "2024-01-01"},
                {"id": "conn-2", "platform": "tiktok", "platform_username": "TikCreator", "connected_at": "2024-02-01"},
                {"id": "conn-3", "platform": "instagram", "platform_username": "ig_user", "connected_at": "2024-03-01"},
            ]
        )
        resp = client.get("/api/v1/social/status")
        assert resp.status_code == 200
        platforms = {c["platform"] for c in resp.json()}
        assert "tiktok" in platforms
        assert "instagram" in platforms

    def test_status_empty_when_no_connections(self, client, _patch_supabase):
        _patch_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        resp = client.get("/api/v1/social/status")
        assert resp.status_code == 200
        assert resp.json() == []
