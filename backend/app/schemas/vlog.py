from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum


class ProcessingStatus(str, Enum):
    pending = "pending"
    transcribing = "transcribing"
    planning = "planning"
    ready = "ready"
    failed = "failed"


class VlogResponse(BaseModel):
    id: str
    platform: str
    platform_video_id: str
    title: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    video_url: Optional[str] = None
    channel_name: Optional[str] = None
    duration_seconds: Optional[int] = None
    published_at: Optional[datetime] = None
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    destinations: List[str] = []
    travel_styles: List[str] = []
    processing_status: ProcessingStatus
    itinerary_id: Optional[str] = None
    created_at: datetime


class FeedPage(BaseModel):
    vlogs: List[VlogResponse]
    next_cursor: Optional[str] = None
    total: int


class VlogInteractionRequest(BaseModel):
    vlog_id: str
    action: str
    duration_watched_seconds: Optional[int] = None
