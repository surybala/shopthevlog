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

    # Duffel (flights)
    DUFFEL_ACCESS_TOKEN: str = ""
    DUFFEL_WEBHOOK_SECRET: str = ""

    # LiteAPI (hotels — primary)
    LITEAPI_API_KEY: str = ""

    # Amadeus (hotels — fallback; also available for flights)
    AMADEUS_CLIENT_ID: str = ""
    AMADEUS_CLIENT_SECRET: str = ""
    # Production payment card for Amadeus hotel orders (leave blank → sandbox test card used)
    AMADEUS_PAYMENT_VENDOR_CODE: str = ""
    AMADEUS_PAYMENT_CARD_NUMBER: str = ""
    AMADEUS_PAYMENT_EXPIRY: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
