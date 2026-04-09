"""
Tests for app.services.transcript_graph_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


def test_build_transcript_segments_splits_sentences_into_timed_chunks():
    from app.services.transcript_graph_service import build_transcript_segments

    segments = build_transcript_segments(
        "Arrive in Tokyo. Check into the hotel. Eat ramen in Shinjuku. Visit Meiji Shrine.",
        duration_seconds=120,
        max_sentences_per_segment=2,
    )

    assert len(segments) == 2
    assert segments[0].start_sec == 0.0
    assert segments[0].end_sec == 60.0
    assert "Arrive in Tokyo." in segments[0].text
    assert segments[1].start_sec == 60.0
    assert segments[1].end_sec == 120.0


def test_build_transcript_segments_falls_back_for_untimestamped_text():
    from app.services.transcript_graph_service import build_transcript_segments

    segments = build_transcript_segments("One long captionless transcript block", duration_seconds=None)

    assert len(segments) == 1
    assert segments[0].start_sec == 0.0
    assert segments[0].end_sec == 30.0


def test_sync_transcript_graph_persists_segments_evidence_candidates_and_opportunities():
    fake_pg = FakePgClient(rows=[])
    extracted_claims = [
        {
            "claim_type": "stayed_at",
            "entity_type": "place",
            "subtype": "hotel",
            "title": "Park Hyatt Tokyo",
            "raw_label": "Park Hyatt",
            "description": "Featured hotel from the Tokyo leg of the trip.",
            "confidence": 0.93,
            "start_sec": 45,
            "end_sec": 80,
            "evidence_summary": "We checked into the Park Hyatt.",
            "attributes": {"recommendation_strength": "high"},
        },
        {
            "claim_type": "itinerary_step",
            "entity_type": "experience",
            "subtype": "itinerary_step",
            "title": "Explore Shinjuku at night",
            "raw_label": "Shinjuku night walk",
            "description": "Evening walk through Shinjuku after check-in.",
            "confidence": 0.76,
            "start_sec": 81,
            "end_sec": 120,
            "evidence_summary": "The vlog moves into a Shinjuku night walk.",
            "attributes": {},
        },
    ]

    with (
        patch("app.services.transcript_graph_service.PgClient", return_value=fake_pg),
        patch(
            "app.services.transcript_graph_service.extract_transcript_graph_payload",
            return_value={
                "skip": False,
                "itinerary": {
                    "title": "5 Days in Tokyo",
                    "summary": "A fantastic trip through Tokyo.",
                    "total_days": 5,
                    "destinations": ["Tokyo"],
                    "countries": ["Japan"],
                    "primary_city": "Tokyo",
                    "estimated_budget_usd": 2000,
                    "days": [],
                },
                "opportunities": extracted_claims,
            },
        ),
    ):
        from app.services.transcript_graph_service import sync_transcript_graph

        result = sync_transcript_graph(
            "vlog-001",
            "creator-001",
            "Tokyo vlog",
            "We checked into the Park Hyatt. Later we explored Shinjuku at night.",
            duration_seconds=120,
        )

    assert result == {
        "segments": 1,
        "evidences": 3,
        "candidate_entities": 2,
        "opportunities": 3,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('INSERT INTO "TranscriptSegment"' in sql for sql in sql_statements)
    assert any('INSERT INTO "Evidence"' in sql for sql in sql_statements)
    assert any('INSERT INTO "CandidateEntity"' in sql for sql in sql_statements)
    assert any('INSERT INTO "Opportunity"' in sql for sql in sql_statements)
    assert any('INSERT INTO "OpportunityEvidence"' in sql for sql in sql_statements)
    assert any('UPDATE "Vlog"' in sql for sql in sql_statements)


def test_sync_transcript_graph_clears_existing_rows_before_reinserting():
    fake_pg = FakePgClient(rows=[])

    with (
        patch("app.services.transcript_graph_service.PgClient", return_value=fake_pg),
        patch(
            "app.services.transcript_graph_service.extract_transcript_graph_payload",
            return_value={"skip": False, "itinerary": None, "opportunities": []},
        ),
    ):
        from app.services.transcript_graph_service import sync_transcript_graph

        sync_transcript_graph("vlog-001", "creator-001", "Tokyo vlog", "Transcript only")

    sql_statements = [query for query, _params in fake_pg.cursor.queries[:6]]
    assert 'DELETE FROM "OpportunityEvidence"' in sql_statements[0]
    assert 'DELETE FROM "Opportunity"' in sql_statements[1]
    assert 'DELETE FROM "ResolvedEntity"' in sql_statements[2]
    assert 'DELETE FROM "CandidateEntity"' in sql_statements[3]
    assert 'DELETE FROM "Evidence"' in sql_statements[4]
    assert 'DELETE FROM "TranscriptSegment"' in sql_statements[5]
