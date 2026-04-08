"""
Tests for app.schemas.vlog — Pydantic model validation and enum values.
"""
import pytest
from datetime import datetime, timezone


class TestProcessingStatus:
    def test_valid_values(self):
        from app.schemas.vlog import ProcessingStatus
        assert ProcessingStatus.pending == "pending"
        assert ProcessingStatus.transcribing == "transcribing"
        assert ProcessingStatus.planning == "planning"
        assert ProcessingStatus.ready == "ready"
        assert ProcessingStatus.failed == "failed"

    def test_is_string_enum(self):
        from app.schemas.vlog import ProcessingStatus
        assert isinstance(ProcessingStatus.ready, str)

    def test_all_five_values_present(self):
        from app.schemas.vlog import ProcessingStatus
        values = {e.value for e in ProcessingStatus}
        assert values == {"pending", "transcribing", "planning", "ready", "failed"}


class TestVlogResponse:
    def _make_valid(self, **overrides):
        from app.schemas.vlog import VlogResponse, ProcessingStatus
        base = {
            "id": "v-1",
            "platform": "youtube",
            "platform_video_id": "yt-abc",
            "title": "My Trip",
            "processing_status": ProcessingStatus.ready,
            "created_at": datetime.now(timezone.utc),
        }
        base.update(overrides)
        return VlogResponse(**base)

    def test_valid_minimal(self):
        vlog = self._make_valid()
        assert vlog.id == "v-1"
        assert vlog.platform == "youtube"

    def test_optional_fields_default_to_none(self):
        vlog = self._make_valid()
        assert vlog.description is None
        assert vlog.thumbnail_url is None
        assert vlog.video_url is None

    def test_list_fields_default_to_empty(self):
        vlog = self._make_valid()
        assert vlog.destinations == []
        assert vlog.travel_styles == []

    def test_with_all_optional_fields(self):
        from app.schemas.vlog import ProcessingStatus
        vlog = self._make_valid(
            description="Great trip",
            thumbnail_url="https://thumb.jpg",
            video_url="https://youtube.com/watch?v=abc",
            channel_name="TravelChan",
            duration_seconds=900,
            view_count=50000,
            like_count=2000,
            destinations=["Japan", "Tokyo"],
            travel_styles=["adventure"],
            itinerary_id="it-99",
            published_at=datetime.now(timezone.utc),
        )
        assert vlog.channel_name == "TravelChan"
        assert vlog.duration_seconds == 900
        assert "Japan" in vlog.destinations


class TestFeedPage:
    def test_valid_empty(self):
        from app.schemas.vlog import FeedPage
        page = FeedPage(vlogs=[], next_cursor=None, total=0)
        assert page.vlogs == []
        assert page.total == 0

    def test_next_cursor_optional(self):
        from app.schemas.vlog import FeedPage
        page = FeedPage(vlogs=[], total=0)
        assert page.next_cursor is None

    def test_total_field(self):
        from app.schemas.vlog import FeedPage
        page = FeedPage(vlogs=[], next_cursor="cursor-abc", total=42)
        assert page.total == 42
        assert page.next_cursor == "cursor-abc"


class TestVlogInteractionRequest:
    def test_valid(self):
        from app.schemas.vlog import VlogInteractionRequest
        req = VlogInteractionRequest(vlog_id="v-1", action="like")
        assert req.vlog_id == "v-1"
        assert req.action == "like"

    def test_duration_optional(self):
        from app.schemas.vlog import VlogInteractionRequest
        req = VlogInteractionRequest(vlog_id="v-1", action="view")
        assert req.duration_watched_seconds is None

    def test_with_duration(self):
        from app.schemas.vlog import VlogInteractionRequest
        req = VlogInteractionRequest(vlog_id="v-1", action="view", duration_watched_seconds=120)
        assert req.duration_watched_seconds == 120

    def test_missing_required_fields_raises(self):
        from app.schemas.vlog import VlogInteractionRequest
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            VlogInteractionRequest(action="like")  # missing vlog_id
