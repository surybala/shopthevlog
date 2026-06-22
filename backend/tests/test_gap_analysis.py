"""
Tests for the demand × coverage whitespace gap map (Phase 4).

Pure / deterministic — no mocks needed beyond plain data.
"""
from app.services.gap_analysis import compute_gap_map, format_gap_section


AUDIENCE = {
    "top_topics": [
        {"topic": "budget breakdown", "frequency": "high"},
        {"topic": "hotel recommendations", "frequency": "medium"},
    ],
    "underserved_needs": ["visa process for digital nomads"],
}

NICHE_TRENDS = [
    {"topic": "Japan 7-day itinerary", "momentum": "RISING", "score": 90},
    {"topic": "budget breakdown", "momentum": "STEADY", "score": 70},
]


class TestComputeGapMap:
    def test_empty_when_no_demand(self):
        assert compute_gap_map(None, None, ["Some video"]) == []

    def test_surfaces_uncovered_demand_topics(self):
        gaps = compute_gap_map(AUDIENCE, None, ["My packing list for Asia", "Tokyo food tour"])
        topics = [g["topic"] for g in gaps]
        assert "budget breakdown" in topics
        # High-frequency, zero coverage → near top
        assert gaps[0]["coverage_count"] == 0

    def test_coverage_reduces_gap_score(self):
        # Creator already covers "budget breakdown" heavily
        covered = compute_gap_map(
            AUDIENCE, None,
            ["Budget breakdown of my trip", "Another budget breakdown", "Budget breakdown 3"],
        )
        uncovered = compute_gap_map(AUDIENCE, None, ["Unrelated video about food"])
        cov_score = next(g["gap_score"] for g in covered if g["topic"] == "budget breakdown")
        unc_score = next(g["gap_score"] for g in uncovered if g["topic"] == "budget breakdown")
        assert cov_score < unc_score

    def test_rising_niche_trend_is_boosted(self):
        gaps = compute_gap_map(None, NICHE_TRENDS, ["Unrelated cooking video"])
        japan = next(g for g in gaps if g["topic"] == "Japan 7-day itinerary")
        assert japan["momentum"] == "RISING"
        # RISING boost pushes a high-score uncovered trend to the very top
        assert gaps[0]["topic"] == "Japan 7-day itinerary"

    def test_merges_duplicate_topics_keeping_highest(self):
        # "budget breakdown" appears in both audience and niche trends
        gaps = compute_gap_map(AUDIENCE, NICHE_TRENDS, ["food video"])
        budget = [g for g in gaps if g["topic"].lower() == "budget breakdown"]
        assert len(budget) == 1

    def test_respects_limit(self):
        many = {"top_topics": [{"topic": f"topic {i} unique", "frequency": "high"} for i in range(20)]}
        gaps = compute_gap_map(many, None, [], limit=3)
        assert len(gaps) == 3

    def test_includes_source_and_demand_fields(self):
        gaps = compute_gap_map(AUDIENCE, None, ["x"])
        g = gaps[0]
        assert set(["topic", "demand", "coverage_count", "momentum", "source", "gap_score"]).issubset(g)


class TestFormatGapSection:
    def test_empty_for_no_gaps(self):
        assert format_gap_section([]) == ""
        assert format_gap_section(None) == ""

    def test_renders_topics_and_momentum(self):
        gaps = compute_gap_map(None, NICHE_TRENDS, ["food"])
        out = format_gap_section(gaps)
        assert "WHITESPACE" in out
        assert "Japan 7-day itinerary" in out
        assert "[RISING]" in out


def test_topic_with_only_stopwords_has_zero_coverage():
    # "the best trip" is all stopwords → no meaningful tokens → coverage 0
    gaps = compute_gap_map(
        {"top_topics": [{"topic": "the best trip", "frequency": "high"}]},
        None,
        ["the best trip ever recorded"],
    )
    assert gaps[0]["coverage_count"] == 0
