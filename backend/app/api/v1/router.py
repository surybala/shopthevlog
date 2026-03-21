from fastapi import APIRouter
from app.api.v1 import auth, social, feed, vlogs, itineraries, trips, flights, hotels, bookings, webhooks

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(social.router)
api_router.include_router(feed.router)
api_router.include_router(vlogs.router)
api_router.include_router(itineraries.router)
api_router.include_router(trips.router)
api_router.include_router(flights.router)
api_router.include_router(hotels.router)
api_router.include_router(bookings.router)
api_router.include_router(webhooks.router)
