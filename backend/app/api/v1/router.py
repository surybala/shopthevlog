from fastapi import APIRouter
from app.api.v1 import social, feed, vlogs, webhooks, preferences

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(social.router)
api_router.include_router(preferences.router)
api_router.include_router(feed.router)
api_router.include_router(vlogs.router)
api_router.include_router(webhooks.router)
