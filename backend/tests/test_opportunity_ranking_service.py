"""
Tests for app.services.opportunity_ranking_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


def test_score_opportunity_prefers_high_confidence_hotel_over_generic_city_guide():
    from app.services.opportunity_ranking_service import score_opportunity

    hotel_score = score_opportunity(
        {
            "id": "opp-001",
            "opportunityType": "HOTEL",
            "confidence": 0.91,
            "reviewState": "APPROVED",
            "metadataJson": {"startSec": 30, "endSec": 90},
            "candidateSubtype": "hotel",
        }
    )
    city_guide_score = score_opportunity(
        {
            "id": "opp-002",
            "opportunityType": "CITY_GUIDE",
            "confidence": 0.58,
            "reviewState": "UNREVIEWED",
            "metadataJson": {},
            "candidateSubtype": None,
        }
    )

    assert hotel_score > city_guide_score


def test_rank_opportunities_updates_each_row_with_deterministic_score():
    fake_pg = FakePgClient(rows=[
        {
            "id": "opp-001",
            "opportunityType": "HOTEL",
            "confidence": 0.91,
            "reviewState": "APPROVED",
            "metadataJson": {"startSec": 30, "endSec": 90},
            "candidateSubtype": "hotel",
        },
        {
            "id": "opp-002",
            "opportunityType": "CITY_GUIDE",
            "confidence": 0.58,
            "reviewState": "UNREVIEWED",
            "metadataJson": {},
            "candidateSubtype": None,
        },
    ])

    with patch("app.services.opportunity_ranking_service.PgClient", return_value=fake_pg):
        from app.services.opportunity_ranking_service import rank_opportunities

        result = rank_opportunities("vlog-001")

    assert result == {"ranked": 2}

    update_params = [params for sql, params in fake_pg.cursor.queries if 'UPDATE "Opportunity"' in sql]
    assert len(update_params) == 2
    assert update_params[0][0] > update_params[1][0]
    assert any('UPDATE "Vlog"' in sql for sql, _params in fake_pg.cursor.queries)


def test_rank_opportunities_handles_empty_vlog_without_error():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.opportunity_ranking_service.PgClient", return_value=fake_pg):
        from app.services.opportunity_ranking_service import rank_opportunities

        result = rank_opportunities("vlog-001")

    assert result == {"ranked": 0}
