"""
Demand × coverage whitespace gap map (Phase 4).

Combines two demand signals — what the creator's audience asks for and what is
trending in their niche right now — and scores each against how much the creator
already covers it. The output is a ranked list of quantified whitespace topics:
high demand the creator under-serves, with RISING niche topics boosted. This is
deterministic (no LLM) so it is cheap, explainable, and easy to test.
"""
import re
from typing import Optional

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Generic words that shouldn't count toward topic/coverage overlap.
_STOP = frozenset({
    "the", "and", "for", "with", "your", "you", "this", "that", "from", "into",
    "best", "top", "guide", "tips", "travel", "vlog", "video", "day", "days",
    "how", "what", "where", "why", "when", "trip", "tour",
})

_FREQ_WEIGHT = {"high": 1.0, "medium": 0.6, "low": 0.3}
_RISING_BOOST = 1.25


def _tokens(text: Optional[str]) -> set[str]:
    return {
        t for t in _TOKEN_RE.findall((text or "").lower())
        if len(t) > 2 and t not in _STOP
    }


def _coverage_count(topic_tokens: set[str], vlog_token_sets: list[set[str]]) -> int:
    """How many of the creator's videos meaningfully cover this topic.

    A video covers a topic when it shares at least half of the topic's
    meaningful tokens — strict enough to avoid one-word coincidences.
    """
    if not topic_tokens:
        return 0
    count = 0
    for vt in vlog_token_sets:
        overlap = len(topic_tokens & vt)
        if overlap and overlap / len(topic_tokens) >= 0.5:
            count += 1
    return count


def compute_gap_map(
    audience: Optional[dict],
    niche_trends: Optional[list[dict]],
    vlog_titles: Optional[list[str]],
    limit: int = 6,
) -> list[dict]:
    """
    Return ranked whitespace gaps:
      [{topic, demand, coverage_count, momentum, source, gap_score}, ...]
    Highest gap_score first. Empty list when there is no demand signal.
    """
    vlog_token_sets = [_tokens(t) for t in (vlog_titles or []) if t]
    total = len(vlog_token_sets)

    # (topic, demand_weight, momentum, source)
    demands: list[tuple[str, float, Optional[str], str]] = []

    if audience:
        for t in audience.get("top_topics") or []:
            topic = (t or {}).get("topic")
            if topic:
                freq = str((t or {}).get("frequency") or "").lower()
                demands.append((topic, _FREQ_WEIGHT.get(freq, 0.5), None, "audience"))
        for need in audience.get("underserved_needs") or []:
            if need:
                demands.append((need, 0.9, None, "underserved"))

    for tr in niche_trends or []:
        topic = (tr or {}).get("topic")
        if topic:
            score = float(tr.get("score") or 0) / 100.0
            demands.append((topic, max(score, 0.4), tr.get("momentum"), "niche_trend"))

    best: dict[str, dict] = {}
    for topic, weight, momentum, source in demands:
        coverage = _coverage_count(_tokens(topic), vlog_token_sets)
        coverage_ratio = (coverage / total) if total else 0.0
        gap_score = weight * (1.0 - min(coverage_ratio, 1.0))
        if str(momentum or "").upper() == "RISING":
            gap_score *= _RISING_BOOST

        gap = {
            "topic": topic,
            "demand": round(weight, 2),
            "coverage_count": coverage,
            "momentum": momentum,
            "source": source,
            "gap_score": round(gap_score, 3),
        }
        key = topic.lower().strip()
        if key not in best or gap["gap_score"] > best[key]["gap_score"]:
            best[key] = gap

    ranked = sorted(best.values(), key=lambda g: g["gap_score"], reverse=True)
    return ranked[:limit]


def format_gap_section(gaps: Optional[list[dict]]) -> str:
    """Render the gap map as a prompt section. "" when there is nothing to show."""
    if not gaps:
        return ""
    lines = []
    for g in gaps:
        momentum = f" [{g['momentum']}]" if g.get("momentum") else ""
        lines.append(
            f"- {g['topic']}{momentum}: demand {g['demand']}, "
            f"creator covers {g['coverage_count']} video(s) (gap {g['gap_score']})"
        )
    return (
        "\n\nWHITESPACE / DEMAND-COVERAGE GAP MAP "
        "(topics in demand that this creator under-serves — prioritise these, "
        "especially RISING ones):\n" + "\n".join(lines)
    )
