from fastapi import APIRouter
from app.api.v1 import vlogs, webhooks, insights

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(vlogs.router)
api_router.include_router(webhooks.router)
api_router.include_router(insights.router)
