"""
Tests for app.db.client — Supabase singleton initialisation.
"""
import pytest
from unittest.mock import patch, MagicMock


class TestGetSupabase:
    def setup_method(self, _method):
        """Reset singleton before each test."""
        import app.db.client as _mod
        _mod._client = None

    def test_returns_client_instance(self):
        mock_client = MagicMock()
        with patch("app.db.client.create_client", return_value=mock_client):
            from app.db.client import get_supabase
            result = get_supabase()
        assert result is mock_client

    def test_second_call_returns_same_instance(self):
        mock_client = MagicMock()
        with patch("app.db.client.create_client", return_value=mock_client) as mock_create:
            from app.db.client import get_supabase
            first = get_supabase()
            second = get_supabase()

        assert first is second
        # create_client should only be called once
        assert mock_create.call_count == 1

    def test_uses_supabase_url_and_key(self):
        mock_client = MagicMock()
        with (
            patch("app.db.client.create_client", return_value=mock_client) as mock_create,
            patch("app.db.client.settings") as mock_settings,
        ):
            mock_settings.SUPABASE_URL = "https://my.supabase.co"
            mock_settings.SUPABASE_SECRET_KEY = "my-secret-key"

            # Reset singleton so it re-creates with patched settings
            import app.db.client as _mod
            _mod._client = None

            from app.db.client import get_supabase
            get_supabase()

        mock_create.assert_called_once_with("https://my.supabase.co", "my-secret-key")
