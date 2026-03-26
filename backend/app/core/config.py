from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "changeme"
    CORS_ORIGINS: str = "http://localhost:5173"

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

    # AI
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    # Local Whisper — set WHISPER_LOCAL_ENABLED=true to enable (requires openai-whisper + ffmpeg + GPU/CPU)
    WHISPER_LOCAL_ENABLED: bool = False
    WHISPER_LOCAL_MODEL: str = "base"  # tiny, base, small, medium, large

    # Duffel (flights)
    DUFFEL_ACCESS_TOKEN: str = ""
    DUFFEL_WEBHOOK_SECRET: str = ""

    # LiteAPI (hotels — primary)
    LITEAPI_API_KEY: str = ""

    # Hotel content enrichment
    GOOGLE_PLACES_API_KEY: str = ""   # Google Places New API (v1) — for photos/reviews
    FOURSQUARE_API_KEY: str = ""      # Foursquare Places v3 — fallback photos/tips

    # Booking.com Demand API
    BOOKING_COM_API_TOKEN: str = ""         # Bearer token (shown once on creation)
    BOOKING_COM_AFFILIATE_ID: str = ""      # Partner / affiliate ID
    BOOKING_COM_SANDBOX: bool = True        # True = sandbox, False = production
    BOOKING_COM_RATE_LIMIT_RPM: int = 45   # Outbound RPM cap (sandbox limit is 50; we leave 5 headroom)

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
