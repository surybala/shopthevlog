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
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str

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

    # Google Places (for location resolution in AI pipeline)
    GOOGLE_PLACES_API_KEY: str = ""

    # Booking.com Demand API
    BOOKING_COM_API_TOKEN: str = ""
    BOOKING_COM_AFFILIATE_ID: str = ""
    BOOKING_COM_SANDBOX: bool = True
    BOOKING_COM_RATE_LIMIT_RPM: int = 45

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
