"""
Tests for app.services.visual_enrichment_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


def test_enrich_visual_graph_persists_visual_evidence_candidates_and_opportunities():
    fake_pg = FakePgClient(rows=[
        {
            "id": "frame-001",
            "timestampSec": 30.0,
            "imageUri": "https://storage.example.com/frame-30.jpg",
            "summary": "Hotel lobby frame",
            "startSec": 0.0,
            "endSec": 60.0,
        },
        {
            "id": "frame-002",
            "timestampSec": 90.0,
            "imageUri": "https://storage.example.com/frame-90.jpg",
            "summary": "Cafe sign frame",
            "startSec": 60.0,
            "endSec": 120.0,
        },
    ])
    visual_signals = [
        {
            "source_type": "ocr",
            "entity_type": "place",
            "subtype": "hotel",
            "title": "Park Hyatt Tokyo",
            "raw_label": "Park Hyatt Tokyo",
            "description": "Hotel signage visible in frame.",
            "confidence": 0.92,
            "claim_type": "visited",
            "evidence_summary": "Readable hotel sign in lobby frame.",
            "attributes": {"text": "Park Hyatt Tokyo"},
        },
        {
            "source_type": "logo_detection",
            "entity_type": "brand",
            "subtype": "brand",
            "title": "Starbucks",
            "raw_label": "Starbucks",
            "description": "Coffee brand logo visible on storefront.",
            "confidence": 0.55,
            "claim_type": "recommends",
            "evidence_summary": "Recognizable Starbucks logo on cafe exterior.",
            "attributes": {},
        },
    ]

    with (
        patch("app.services.visual_enrichment_service.PgClient", return_value=fake_pg),
        patch(
            "app.services.visual_enrichment_service.extract_visual_opportunities_batch",
            return_value={
                "frame-001": visual_signals,
                "frame-002": [],
            },
        ),
    ):
        from app.services.visual_enrichment_service import enrich_visual_graph

        result = enrich_visual_graph("vlog-001", "creator-001", "Tokyo vlog")

    assert result == {
        "evidences": 2,
        "candidate_entities": 1,
        "opportunities": 1,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('DELETE FROM "Evidence"' in sql for sql in sql_statements)
    assert any('INSERT INTO "Evidence"' in sql for sql in sql_statements)
    assert any('INSERT INTO "CandidateEntity"' in sql for sql in sql_statements)
    assert any('INSERT INTO "Opportunity"' in sql for sql in sql_statements)
    assert any('INSERT INTO "OpportunityEvidence"' in sql for sql in sql_statements)


def test_enrich_visual_graph_handles_empty_frame_set():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.visual_enrichment_service.PgClient", return_value=fake_pg):
        from app.services.visual_enrichment_service import enrich_visual_graph

        result = enrich_visual_graph("vlog-001", "creator-001", "Tokyo vlog")

    assert result == {
        "evidences": 0,
        "candidate_entities": 0,
        "opportunities": 0,
    }
