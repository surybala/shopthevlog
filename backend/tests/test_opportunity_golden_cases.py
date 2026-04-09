"""
Golden-set evaluation tests for opportunity ranking and review recommendations.

These cases represent representative creator-facing outcomes we want to keep
stable as the pipeline evolves.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _load_cases():
    fixture_path = Path(__file__).parent / "fixtures" / "golden_opportunity_cases.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _load_cases(), ids=lambda case: case["name"])
def test_golden_opportunity_cases(case):
    from app.services.opportunity_ranking_service import build_review_metadata, score_opportunity

    creator_memory = {}
    for raw_key, value in case["creatorMemory"].items():
        memory_type, key = raw_key.split("|", 1)
        creator_memory[(memory_type, key)] = value

    score = score_opportunity(case["row"], creator_memory)
    review_state, metadata = build_review_metadata(case["row"], score, creator_memory)

    min_score = case["expected"].get("minScore")
    max_score = case["expected"].get("maxScore")
    if min_score is not None:
        assert score >= min_score
    if max_score is not None:
        assert score <= max_score
    assert review_state == case["expected"]["reviewState"]
    assert metadata["reviewRecommendation"] == case["expected"]["reviewRecommendation"]
    for signal in case["expected"]["requiredSignals"]:
        assert signal in metadata["reviewSignals"]
