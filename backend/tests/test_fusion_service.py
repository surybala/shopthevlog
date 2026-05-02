"""
Tests for app.services.fusion_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


def test_fuse_candidate_entities_merges_duplicate_candidates_and_repoints_opportunities():
    fake_pg = FakePgClient(rows=[
        {
            "id": "cand-001",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt",
            "startSec": 30.0,
            "endSec": 60.0,
            "confidence": 0.81,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-001"], "sourceTypes": ["TRANSCRIPT"]},
        },
        {
            "id": "cand-002",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt Tokyo",
            "startSec": 62.0,
            "endSec": 84.0,
            "confidence": 0.74,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-002"], "sourceTypes": ["TRANSCRIPT"]},
        },
        {
            "id": "cand-003",
            "entityType": "PLACE",
            "subtype": "restaurant",
            "canonicalLabel": "Ichiran Shibuya",
            "rawLabel": "Ichiran",
            "startSec": 120.0,
            "endSec": 150.0,
            "confidence": 0.7,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-003"], "sourceTypes": ["TRANSCRIPT"]},
        },
    ])

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 1,
        "deduped_opportunities": 0,
        "merged_candidates": 1,
        "remaining_candidates": 2,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('UPDATE "CandidateEntity"' in sql for sql in sql_statements)
    assert any('UPDATE "Opportunity"' in sql for sql in sql_statements)
    assert any('DELETE FROM "CandidateEntity"' in sql for sql in sql_statements)
    assert any('UPDATE "Vlog"' in sql for sql in sql_statements)

    update_params = next(params for sql, params in fake_pg.cursor.queries if 'UPDATE "CandidateEntity"' in sql)
    assert update_params[1] == 30.0
    assert update_params[2] == 84.0
    assert update_params[3] > 0.81
    assert '"fusionVersion": "phase4-v2"' in update_params[4]


def test_fuse_candidate_entities_leaves_unique_candidates_unchanged():
    fake_pg = FakePgClient(rows=[
        {
            "id": "cand-001",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt",
            "startSec": 30.0,
            "endSec": 60.0,
            "confidence": 0.81,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-001"], "sourceTypes": ["TRANSCRIPT"]},
        }
    ])

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 0,
        "deduped_opportunities": 0,
        "merged_candidates": 0,
        "remaining_candidates": 1,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert not any('DELETE FROM "CandidateEntity"' in sql for sql in sql_statements)


def test_fuse_candidate_entities_merges_multimodal_aliases_and_marks_multimodal_bundle():
    fake_pg = FakePgClient(rows=[
        {
            "id": "cand-001",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt",
            "rawLabel": "Park Hyatt",
            "startSec": 30.0,
            "endSec": 60.0,
            "confidence": 0.72,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-001"], "sourceTypes": ["TRANSCRIPT"]},
        },
        {
            "id": "cand-002",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt Tokyo",
            "startSec": 31.0,
            "endSec": 61.0,
            "confidence": 0.83,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-002"], "sourceTypes": ["VISUAL"]},
        },
    ])

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 1,
        "deduped_opportunities": 0,
        "merged_candidates": 1,
        "remaining_candidates": 1,
    }

    update_params = next(params for sql, params in fake_pg.cursor.queries if 'UPDATE "CandidateEntity"' in sql)
    assert update_params[0] == "Park Hyatt Tokyo"
    assert update_params[3] > 0.87
    assert '"isMultimodal": true' in update_params[4]
    assert '"sourceTypes": ["TRANSCRIPT", "VISUAL"]' in update_params[4]


def test_fuse_candidate_entities_dedupes_duplicate_opportunities_for_same_fused_candidate():
    fake_pg = FakePgClient(rows=[
        {
            "id": "cand-001",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt Tokyo",
            "startSec": 30.0,
            "endSec": 60.0,
            "confidence": 0.81,
            "status": "NEW",
            "evidenceBundleJson": {"evidenceIds": ["ev-001"], "sourceTypes": ["TRANSCRIPT", "OCR"]},
        },
    ])

    def _fake_fetchall():
        last_sql, _params = fake_pg.cursor.queries[-1]
        if 'FROM "CandidateEntity"' in last_sql:
            return fake_pg.cursor._rows
        if 'FROM "Opportunity"' in last_sql:
            return [
                {
                    "id": "opp-001",
                    "candidateEntityId": "cand-001",
                    "opportunityType": "HOTEL",
                    "title": "Park Hyatt Tokyo",
                    "description": "Transcript mention of the hotel stay.",
                    "confidence": 0.84,
                    "reviewState": "UNREVIEWED",
                    "publishState": "DRAFT",
                    "metadataJson": {"sourceType": "TRANSCRIPT", "sourceTypes": ["TRANSCRIPT"]},
                },
                {
                    "id": "opp-002",
                    "candidateEntityId": "cand-001",
                    "opportunityType": "HOTEL",
                    "title": "Park Hyatt Tokyo",
                    "description": "Visible hotel signage from frame analysis.",
                    "confidence": 0.79,
                    "reviewState": "UNREVIEWED",
                    "publishState": "DRAFT",
                    "metadataJson": {"sourceType": "VISUAL", "sourceTypes": ["OCR"]},
                },
            ]
        return []

    fake_pg.fetchall = _fake_fetchall

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 0,
        "deduped_opportunities": 1,
        "merged_candidates": 0,
        "remaining_candidates": 1,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('UPDATE "OpportunityEvidence"' in sql for sql in sql_statements)
    assert any('DELETE FROM "Opportunity" WHERE id = %s' in sql for sql in sql_statements)

    update_params = next(
        params for sql, params in fake_pg.cursor.queries
        if 'UPDATE "Opportunity"' in sql and '"metadataJson"' in sql
    )
    assert update_params[0] == 0.84
    assert '"dedupeVersion": "phase4-v3"' in update_params[1]
    assert '"sourceKinds": ["TRANSCRIPT", "VISUAL"]' in update_params[1]
