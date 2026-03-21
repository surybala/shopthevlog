from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date


class TripCreate(BaseModel):
    itinerary_id: Optional[str] = None
    vlog_id: Optional[str] = None
    name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    traveller_count: int = 1
    notes: Optional[str] = None


class TripUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    traveller_count: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class TripResponse(BaseModel):
    id: str
    user_id: str
    itinerary_id: Optional[str] = None
    vlog_id: Optional[str] = None
    name: str
    status: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    traveller_count: int
    notes: Optional[str] = None
    created_at: datetime
