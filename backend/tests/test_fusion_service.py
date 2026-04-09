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
            "evidenceBundleJson": {"evidenceIds": ["ev-001"]},
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
            "evidenceBundleJson": {"evidenceIds": ["ev-002"]},
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
            "evidenceBundleJson": {"evidenceIds": ["ev-003"]},
        },
    ])

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 1,
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
            "evidenceBundleJson": {"evidenceIds": ["ev-001"]},
        }
    ])

    with patch("app.services.fusion_service.PgClient", return_value=fake_pg):
        from app.services.fusion_service import fuse_candidate_entities

        result = fuse_candidate_entities("vlog-001")

    assert result == {
        "clusters": 0,
        "merged_candidates": 0,
        "remaining_candidates": 1,
    }

    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert not any('DELETE FROM "CandidateEntity"' in sql for sql in sql_statements)
