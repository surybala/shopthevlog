"""
Tests for app.core.config — Settings class and derived properties.
"""
import pytest
from unittest.mock import patch


class TestSettings:
    def test_cors_origins_list_single(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            CORS_ORIGINS="http://localhost:3000",
        )
        assert s.cors_origins_list == ["http://localhost:3000"]

    def test_cors_origins_list_multiple(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            CORS_ORIGINS="http://localhost:3000,https://example.com, https://app.example.com",
        )
        assert s.cors_origins_list == [
            "http://localhost:3000",
            "https://example.com",
            "https://app.example.com",
        ]

    def test_cors_origins_list_trims_whitespace(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            CORS_ORIGINS="  http://a.com ,  http://b.com  ",
        )
        assert s.cors_origins_list == ["http://a.com", "http://b.com"]

    def test_default_app_env_is_development(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
        )
        assert s.APP_ENV == "development"

    def test_redis_url_can_be_overridden(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            REDIS_URL="redis://custom-host:6380",
        )
        assert s.REDIS_URL == "redis://custom-host:6380"

    def test_gemini_api_key_can_be_set(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            GEMINI_API_KEY="my-gemini-key",
        )
        assert s.GEMINI_API_KEY == "my-gemini-key"

    def test_youtube_api_key_can_be_set(self):
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            YOUTUBE_API_KEY="yt-api-key",
        )
        assert s.YOUTUBE_API_KEY == "yt-api-key"

    def test_settings_singleton_is_settings_instance(self):
        from app.core.config import settings, Settings
        assert isinstance(settings, Settings)

    def test_extra_env_vars_are_ignored(self):
        """extra='ignore' in model_config — unknown env vars must not raise."""
        from app.core.config import Settings
        s = Settings(
            DATABASE_URL="postgresql://x:y@localhost/db",
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SECRET_KEY="test-key",
            UNKNOWN_VAR_XYZ="should-be-ignored",  # type: ignore[call-arg]
        )
        assert s.SUPABASE_URL == "https://test.supabase.co"
