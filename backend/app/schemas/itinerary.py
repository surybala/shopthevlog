from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ActivityResponse(BaseModel):
    id: str
    day_id: str
    order_index: int
    type: str
    name: str
    description: Optional[str] = None
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    estimated_cost_usd: Optional[int] = None
    duration_minutes: Optional[int] = None
    booking_url: Optional[str] = None
    image_url: Optional[str] = None


class DayResponse(BaseModel):
    id: str
    itinerary_id: str
    day_number: int
    location: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    activities: List[ActivityResponse] = []


class ItineraryResponse(BaseModel):
    id: str
    vlog_id: str
    title: str
    summary: Optional[str] = None
    total_days: Optional[int] = None
    destinations: List[str] = []
    estimated_budget_usd: Optional[int] = None
    days: List[DayResponse] = []
    created_at: datetime


class RegenerateRequest(BaseModel):
    budget_range: Optional[str] = None
    travel_style: Optional[str] = None
    max_days: Optional[int] = None
