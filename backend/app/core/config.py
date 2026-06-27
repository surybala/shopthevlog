from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "changeme"
    CORS_ORIGINS: str = "http://localhost:3000"

    # Database
    DATABASE_URL: str

    # Supabase
    SUPABASE_URL: str
    SUPABASE_SECRET_KEY: str          # formerly SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_STORAGE_BUCKET: str = "ai-pipeline-assets"
    # SUPABASE_JWT_SECRET removed — project uses new JWT Signing Keys (JWKS/ES256)

    # YouTube
    YOUTUBE_CLIENT_ID: str = ""
    YOUTUBE_CLIENT_SECRET: str = ""
    YOUTUBE_REDIRECT_URI: str = "http://localhost:8000/api/v1/social/connect/youtube/callback"
    YOUTUBE_API_KEY: str = ""

    # Instagram
    INSTAGRAM_CLIENT_ID: str = ""
    INSTAGRAM_CLIENT_SECRET: str = ""
    INSTAGRAM_REDIRECT_URI: str = "http://localhost:8000/api/v1/social/connect/instagram/callback"

    # TikTok (Login Kit v2)
    TIKTOK_CLIENT_KEY: str = ""
    TIKTOK_CLIENT_SECRET: str = ""
    TIKTOK_REDIRECT_URI: str = "http://localhost:8000/api/v1/social/connect/tiktok/callback"

    # AI
    GEMINI_API_KEY: str = ""

    # Cost guardrails — durable daily budgets on costly external APIs.
    # YouTube Data API ships with a default 10,000 units/day; a search costs 100.
    COST_GUARD_ENABLED: bool = True
    YOUTUBE_DAILY_UNIT_BUDGET: int = 9000
    GEMINI_DAILY_CALL_BUDGET: int = 5000

    # Google Places (for location resolution in AI pipeline)
    GOOGLE_PLACES_API_KEY: str = ""

    # Insights
    INSIGHTS_CACHE_TTL_HOURS: int = 6

    # Sentry
    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.0

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
