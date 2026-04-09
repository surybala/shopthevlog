"""
Tests for app.services.resolution_service.
"""
from unittest.mock import patch

from tests.conftest import FakePgClient


class SequentialFetchPgClient(FakePgClient):
    def __init__(self, rows, fetch_sequence):
        super().__init__(rows=rows)
        self._fetch_sequence = list(fetch_sequence)

    def fetchone(self):
        if self._fetch_sequence:
            return self._fetch_sequence.pop(0)
        return super().fetchone()


def test_resolve_candidates_creates_resolved_entities_and_updates_opportunities():
    candidates = [
        {
            "id": "cand-001",
            "entityType": "PLACE",
            "subtype": "hotel",
            "canonicalLabel": "Park Hyatt Tokyo",
            "rawLabel": "Park Hyatt Tokyo",
            "confidence": 0.91,
            "status": "NEW",
        },
        {
            "id": "cand-002",
            "entityType": "PRODUCT",
            "subtype": "travel_product",
            "canonicalLabel": "Peak Design 45L Travel Backpack",
            "rawLabel": "Peak Design backpack",
            "confidence": 0.84,
            "status": "NEW",
        },
    ]
    fake_pg = SequentialFetchPgClient(
        rows=candidates,
        fetch_sequence=[{"id": "resolved-001"}, {"id": "resolved-002"}],
    )

    with patch("app.services.resolution_service.PgClient", return_value=fake_pg):
        from app.services.resolution_service import resolve_candidates

        result = resolve_candidates("vlog-001")

    assert result == {"resolved": 2}
    sql_statements = [query for query, _params in fake_pg.cursor.queries]
    assert any('INSERT INTO "ResolvedEntity"' in sql for sql in sql_statements)
    assert any('UPDATE "CandidateEntity"' in sql for sql in sql_statements)
    assert any('UPDATE "Opportunity"' in sql for sql in sql_statements)
    assert any('UPDATE "Vlog"' in sql for sql in sql_statements)


def test_resolve_candidates_handles_empty_vlog():
    fake_pg = FakePgClient(rows=[])

    with patch("app.services.resolution_service.PgClient", return_value=fake_pg):
        from app.services.resolution_service import resolve_candidates

        result = resolve_candidates("vlog-001")

    assert result == {"resolved": 0}
