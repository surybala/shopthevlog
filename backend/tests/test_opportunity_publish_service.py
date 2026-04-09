"""
Tests for graph-backed TripKit publishing.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


class SequentialFetchPgClient(FakePgClient):
    def __init__(self, fetch_sequence):
        super().__init__(rows=[])
        self._fetch_sequence = list(fetch_sequence)

    def fetchone(self):
        if not self._fetch_sequence:
            return None
        return self._fetch_sequence.pop(0)


def test_publish_tripkit_from_graph_creates_tripkit_when_none_exists():
    itinerary_metadata = {
        "itinerary": {
            "title": "5 Days in Tokyo",
            "summary": "A fantastic trip through Tokyo.",
            "total_days": 5,
            "destinations": ["Tokyo", "Shibuya"],
            "countries": ["Japan"],
            "primary_city": "Tokyo",
            "estimated_budget_usd": 2000,
            "days": [
                {
                    "day_number": 1,
                    "city": "Tokyo",
                    "country": "Japan",
                    "title": "Arrival in Tokyo",
                    "summary": "Check in and explore Shinjuku.",
                    "tips": ["Get a Suica card"],
                    "activities": [
                        {
                            "sort_order": 0,
                            "type": "ACCOMMODATION",
                            "title": "Park Hyatt Tokyo",
                            "description": "Check into the hotel.",
                            "time": "16:00",
                            "latitude": 35.6867,
                            "longitude": 139.6921,
                            "image_url": None,
                        }
                    ],
                }
            ],
        }
    }

    select_pg = FakePgClient(rows=[{
        "id": "vlog-001",
        "title": "Tokyo vlog",
        "creatorId": "creator-001",
        "opportunityId": "opp-001",
        "opportunityTitle": "5 Days in Tokyo",
        "opportunityDescription": "A fantastic trip through Tokyo.",
        "metadataJson": itinerary_metadata,
    }])
    publish_pg = SequentialFetchPgClient([None, {"id": "kit-001"}, {"id": "day-001"}])

    with patch("app.services.opportunity_publish_service.PgClient", side_effect=[select_pg, publish_pg]):
        from app.services.opportunity_publish_service import publish_tripkit_from_graph

        result = publish_tripkit_from_graph("vlog-001")

    assert result is True
    sql_statements = [sql for sql, _params in publish_pg.cursor.queries]
    assert any('INSERT INTO "TripKit"' in sql for sql in sql_statements)
    assert any('INSERT INTO "TripKitsOnVlogs"' in sql for sql in sql_statements)
    assert any('INSERT INTO "ItineraryDay"' in sql for sql in sql_statements)
    assert any('INSERT INTO "DayActivity"' in sql for sql in sql_statements)
    assert any('UPDATE "Opportunity"' in sql for sql in sql_statements)
    assert 'true, false, true' in next(sql for sql in sql_statements if 'INSERT INTO "TripKit"' in sql)
    assert any("PUBLISHED" in sql for sql in sql_statements if 'UPDATE "Vlog"' in sql)


def test_publish_tripkit_from_graph_updates_existing_tripkit():
    itinerary_metadata = {
        "itinerary": {
            "title": "Updated Tokyo Trip",
            "summary": "Updated summary.",
            "total_days": 3,
            "destinations": ["Tokyo"],
            "countries": ["Japan"],
            "primary_city": "Tokyo",
            "estimated_budget_usd": 1800,
            "days": [],
        }
    }

    select_pg = FakePgClient(rows=[{
        "id": "vlog-001",
        "title": "Tokyo vlog",
        "creatorId": "creator-001",
        "opportunityId": "opp-001",
        "opportunityTitle": "Updated Tokyo Trip",
        "opportunityDescription": "Updated summary.",
        "metadataJson": itinerary_metadata,
    }])
    publish_pg = SequentialFetchPgClient([{"tripKitId": "kit-001"}])

    with patch("app.services.opportunity_publish_service.PgClient", side_effect=[select_pg, publish_pg]):
        from app.services.opportunity_publish_service import publish_tripkit_from_graph

        result = publish_tripkit_from_graph("vlog-001")

    assert result is True
    sql_statements = [sql for sql, _params in publish_pg.cursor.queries]
    assert any('UPDATE "TripKit"' in sql for sql in sql_statements)
    assert any('DELETE FROM "DayActivity"' in sql for sql in sql_statements)
    assert any('DELETE FROM "ItineraryDay"' in sql for sql in sql_statements)
    assert '"isPublished" = true' in next(sql for sql in sql_statements if 'UPDATE "TripKit"' in sql)


def test_publish_tripkit_from_graph_returns_false_without_publishable_itinerary():
    select_pg = FakePgClient(rows=[])

    with patch("app.services.opportunity_publish_service.PgClient", return_value=select_pg):
        from app.services.opportunity_publish_service import publish_tripkit_from_graph

        result = publish_tripkit_from_graph("vlog-001")

    assert result is False
