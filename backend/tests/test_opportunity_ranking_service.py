"""
Tests for app.services.opportunity_ranking_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


class SequentialFetchAllPgClient(FakePgClient):
    def __init__(self, fetchall_sequence):
        super().__init__(rows=[])
        self._fetchall_sequence = list(fetchall_sequence)

    def fetchall(self):
        if self._fetchall_sequence:
            return self._fetchall_sequence.pop(0)
        return []


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
            "candidateEntityType": "PLACE",
            "candidateCanonicalLabel": "Park Hyatt Tokyo",
            "candidateRawLabel": "Park Hyatt Tokyo",
            "resolvedName": "Park Hyatt Tokyo",
            "resolutionMatchType": "EXACT",
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
            "candidateEntityType": "PLACE",
            "candidateCanonicalLabel": None,
            "candidateRawLabel": None,
            "resolvedName": None,
            "resolutionMatchType": None,
        }
    )

    assert hotel_score > city_guide_score


def test_score_opportunity_applies_creator_memory_boost_and_penalty():
    from app.services.opportunity_ranking_service import score_opportunity

    accepted_score = score_opportunity(
        {
            "id": "opp-001",
            "title": "Park Hyatt Tokyo",
            "opportunityType": "HOTEL",
            "confidence": 0.7,
            "reviewState": "UNREVIEWED",
            "metadataJson": {"startSec": 30, "endSec": 90},
            "candidateSubtype": "hotel",
            "candidateEntityType": "PLACE",
            "candidateCanonicalLabel": "Park Hyatt Tokyo",
            "candidateRawLabel": "Park Hyatt",
            "resolvedName": "Park Hyatt Tokyo",
            "resolutionMatchType": "LIKELY",
        },
        {
            ("ACCEPTED_PLACE", "park hyatt tokyo"): {"memoryType": "ACCEPTED_PLACE"},
            ("NAMING_PREFERENCE", "park hyatt tokyo"): {"memoryType": "NAMING_PREFERENCE"},
        },
    )

    rejected_score = score_opportunity(
        {
            "id": "opp-002",
            "title": "Mystery Hotel",
            "opportunityType": "HOTEL",
            "confidence": 0.7,
            "reviewState": "UNREVIEWED",
            "metadataJson": {"startSec": 30, "endSec": 90},
            "candidateSubtype": "hotel",
            "candidateEntityType": "PLACE",
            "candidateCanonicalLabel": "Mystery Hotel",
            "candidateRawLabel": "Mystery Hotel",
            "resolvedName": "Mystery Hotel",
            "resolutionMatchType": "LIKELY",
        },
        {
            ("REJECTED_PLACE", "mystery hotel"): {"memoryType": "REJECTED_PLACE"},
        },
    )

    assert accepted_score > rejected_score


def test_build_review_metadata_auto_approves_when_positive_memory_and_resolution_are_strong():
    from app.services.opportunity_ranking_service import build_review_metadata

    review_state, metadata = build_review_metadata(
        {
            "id": "opp-001",
            "title": "Peak Design 45L Travel Backpack",
            "opportunityType": "TRAVEL_PRODUCT",
            "confidence": 0.89,
            "reviewState": "UNREVIEWED",
            "metadataJson": {"source": "pipeline"},
            "candidateSubtype": "travel_product",
            "candidateEntityType": "PRODUCT",
            "candidateCanonicalLabel": "Peak Design 45L Travel Backpack",
            "candidateRawLabel": "Peak Design backpack",
            "resolvedName": "Peak Design 45L Travel Backpack",
            "resolutionMatchType": "EXACT",
        },
        0.91,
        {
            ("ACCEPTED_PRODUCT", "peak design 45l travel backpack"): {"memoryType": "ACCEPTED_PRODUCT"},
            ("RECURRING_ITEM", "peak design 45l travel backpack"): {"memoryType": "RECURRING_ITEM"},
        },
    )

    assert review_state == "AUTO_APPROVED"
    assert metadata["source"] == "pipeline"
    assert metadata["reviewRecommendation"] == "auto_approved_from_memory"
    assert "accepted_memory" in metadata["reviewSignals"]
    assert "exact_resolution" in metadata["reviewSignals"]


def test_build_review_metadata_flags_rejected_memory_for_manual_review():
    from app.services.opportunity_ranking_service import build_review_metadata

    review_state, metadata = build_review_metadata(
        {
            "id": "opp-002",
            "title": "Mystery Hotel",
            "opportunityType": "HOTEL",
            "confidence": 0.83,
            "reviewState": "UNREVIEWED",
            "metadataJson": {},
            "candidateSubtype": "hotel",
            "candidateEntityType": "PLACE",
            "candidateCanonicalLabel": "Mystery Hotel",
            "candidateRawLabel": "Mystery Hotel",
            "resolvedName": "Mystery Hotel",
            "resolutionMatchType": "LIKELY",
        },
        0.84,
        {
            ("REJECTED_PLACE", "mystery hotel"): {"memoryType": "REJECTED_PLACE"},
        },
    )

    assert review_state == "UNREVIEWED"
    assert metadata["reviewRecommendation"] == "needs_scrutiny"
    assert "rejected_memory" in metadata["reviewSignals"]


def test_rank_opportunities_updates_each_row_with_deterministic_score():
    fake_pg = SequentialFetchAllPgClient([
        [
            {
                "id": "opp-001",
                "title": "Park Hyatt Tokyo",
                "creatorId": "creator-001",
                "opportunityType": "HOTEL",
                "confidence": 0.91,
                "reviewState": "UNREVIEWED",
                "metadataJson": {"startSec": 30, "endSec": 90},
                "candidateSubtype": "hotel",
                "candidateEntityType": "PLACE",
                "candidateCanonicalLabel": "Park Hyatt Tokyo",
                "candidateRawLabel": "Park Hyatt Tokyo",
                "resolvedName": "Park Hyatt Tokyo",
                "resolutionMatchType": "EXACT",
            },
            {
                "id": "opp-002",
                "title": "Tokyo City Guide",
                "creatorId": "creator-001",
                "opportunityType": "CITY_GUIDE",
                "confidence": 0.58,
                "reviewState": "UNREVIEWED",
                "metadataJson": {},
                "candidateSubtype": None,
                "candidateEntityType": "PLACE",
                "candidateCanonicalLabel": None,
                "candidateRawLabel": None,
                "resolvedName": None,
                "resolutionMatchType": None,
            },
        ],
        [
            {
                "memoryType": "ACCEPTED_PLACE",
                "key": "park hyatt tokyo",
                "valueJson": {"source": "creator"},
            }
        ],
    ])

    with patch("app.services.opportunity_ranking_service.PgClient", return_value=fake_pg):
        from app.services.opportunity_ranking_service import rank_opportunities

        result = rank_opportunities("vlog-001")

    assert result == {"ranked": 2}

    update_params = [params for sql, params in fake_pg.cursor.queries if 'UPDATE "Opportunity"' in sql]
    assert len(update_params) == 2
    assert update_params[0][0] > update_params[1][0]
    assert update_params[0][1] == "AUTO_APPROVED"
    assert '"reviewRecommendation": "auto_approved_from_memory"' in update_params[0][2]
    assert update_params[1][1] == "UNREVIEWED"
    assert any('UPDATE "Vlog"' in sql for sql, _params in fake_pg.cursor.queries)


def test_rank_opportunities_handles_empty_vlog_without_error():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.opportunity_ranking_service.PgClient", return_value=fake_pg):
        from app.services.opportunity_ranking_service import rank_opportunities

        result = rank_opportunities("vlog-001")

    assert result == {"ranked": 0}
