"""
Gemini-powered insights service for creator growth analytics.

Analyzes vlog performance patterns, extracts audience demand signals from
comments, and generates data-backed content briefs.

Runs as a parallel pipeline — the TripKit generation pipeline
(gemini_service.py) is intentionally untouched. Reuses the private Gemini
helpers (_call_gemini, _parse_response) from that module to share the lazy
client, model constant, and JSON-parsing logic without duplicating them.
"""
import json
import logging
from typing import Optional

from app.services.gemini_service import _call_gemini, _parse_response

logger = logging.getLogger(__name__)

# ─── Prompts ──────────────────────────────────────────────────────────────────

CONTENT_PATTERN_PROMPT = """You are a YouTube growth analyst specialising in travel creators.
You receive performance data for a creator's videos — titles, view counts, and transcript excerpts.
Your job: explain WHY the top-performing videos work and identify clear content strengths and gaps.

Return ONE valid JSON object only. No markdown, no backticks.

Schema:
{
  "channel_niche": "string (e.g. 'budget backpacking Southeast Asia', 'luxury solo travel Europe')",
  "creator_archetype": "string (e.g. 'budget adventurer', 'luxury reviewer', 'family travel', 'solo female traveller')",
  "top_patterns": [
    "string — specific, actionable observation about what makes top videos succeed (max 20 words each)"
  ],
  "weak_patterns": [
    "string — specific observation about what underperforming videos have in common (max 20 words each)"
  ],
  "content_strengths": [
    "string — what this creator does better than average in their niche"
  ],
  "content_gaps": [
    "string — topics the audience clearly wants but the creator hasn't covered well"
  ],
  "recommended_formats": [
    "string — video formats or angles that work well for this specific creator"
  ]
}

Rules:
- top_patterns: max 5 items
- weak_patterns: max 3 items
- Be specific to THIS creator, not generic YouTube advice
- If ALL creator videos show 0 views, view count data is unavailable — analyze based on titles, transcripts, and niche instead
- If view counts are unavailable or identical, skip weak_patterns and top_patterns based on views; instead derive patterns from content topics and titles
- content_gaps: when view data is sparse, use benchmark videos to identify proven formats this creator hasn't covered; if no benchmarks, derive gaps from title/topic analysis
- When benchmarks are present: identify what proven formats the creator hasn't explored, and what angles they could own that benchmarks don't cover
- Never output "data is insufficient" as a gap or pattern — always provide actionable, topic-specific observations based on whatever data IS available
"""

AUDIENCE_DEMAND_PROMPT = """You are a YouTube audience analyst. You receive a batch of real viewer comments from a travel creator's videos.
Extract what the audience wants, what questions they ask repeatedly, and what excites them.

Return ONE valid JSON object only. No markdown, no backticks.

Schema:
{
  "top_topics": [
    {
      "topic": "string (e.g. 'budget breakdown', 'hotel recommendations', 'visa process')",
      "frequency": "high|medium|low",
      "example_comment": "string (short verbatim quote under 15 words that shows this demand)"
    }
  ],
  "recurring_questions": [
    "string — questions asked repeatedly across multiple videos"
  ],
  "emotional_triggers": [
    "string — topics or moments that genuinely excite or resonate with this audience"
  ],
  "underserved_needs": [
    "string — what the audience asks for but clearly isn't getting"
  ]
}

Rules:
- top_topics: max 8 items, only what is actually present in comments
- recurring_questions: max 5 items
- Never fabricate data not present in comments
- If comments are sparse, return minimal honest lists rather than guessing
"""

CONTENT_BRIEF_PROMPT = """You are a YouTube content strategist for travel creators.
You receive a creator's performance pattern analysis and audience demand signals.
Generate exactly 4 specific, high-potential content briefs this creator should film next.

Return ONE valid JSON object only. No markdown, no backticks.

Schema:
{
  "briefs": [
    {
      "title": "string (compelling YouTube title, under 70 characters)",
      "hook_ideas": [
        "string — a concrete opening 30-second hook concept (max 3 per brief)"
      ],
      "content_outline": [
        "string — a key section or beat for the video (4-6 items)"
      ],
      "trend_signal": "string | null (why this topic is timely right now, or null if not applicable)",
      "audience_signal": "string | null (the specific audience demand this directly addresses)",
      "estimated_score": integer (0-100, predicted performance vs this creator's average — be realistic),
      "reasoning": "string (2 sentences: why this will specifically work for THIS creator, citing data)"
    }
  ]
}

Rules:
- Exactly 4 briefs in the array
- Each brief must be rooted in the creator's specific patterns and audience data — no generic ideas
- estimated_score: 70+ = strong expected outperformance, 50-69 = solid, below 50 = speculative
- Content must be filmable travel content, not studio-only
- reasoning must reference specific data points from the performance analysis or audience signals
- Titles should be genuinely compelling, not formulaic
"""

# ─── Public API ───────────────────────────────────────────────────────────────

def analyze_content_patterns(
    vlogs: list[dict],
    creator_handle: str,
    benchmarks: Optional[list[dict]] = None,
) -> Optional[dict]:
    """
    Analyze why top videos outperform the rest for this creator.

    vlogs: list of dicts with at minimum: title, viewCount, transcript_excerpt.
    benchmarks: optional list of top-performing public videos in the same niche,
                used to enrich analysis for small/growing channels.
    Returns a structured patterns dict on success, None on failure.
    """
    if not vlogs:
        return None

    view_counts = [v.get("viewCount") or 0 for v in vlogs]
    has_view_data = any(c > 0 for c in view_counts)

    top = sorted(vlogs, key=lambda v: v.get("viewCount") or 0, reverse=True)[:5]
    bottom = sorted(vlogs, key=lambda v: v.get("viewCount") or 0)[:5]

    top_section = "\n".join(
        f"- [{v.get('viewCount', 0):,} views] {v['title']}: {(v.get('transcript_excerpt') or '')[:300]}"
        for v in top
    )
    bottom_section = "\n".join(
        f"- [{v.get('viewCount', 0):,} views] {v['title']}: {(v.get('transcript_excerpt') or '')[:150]}"
        for v in bottom
    )

    view_data_note = (
        ""
        if has_view_data
        else "\nNOTE: View count data is unavailable for this creator (all show 0). "
             "Analyze patterns based on titles, topics, and transcript content only. "
             "Rely heavily on niche benchmarks when provided.\n"
    )

    prompt = (
        f"Creator: @{creator_handle}\n"
        f"Total videos analyzed: {len(vlogs)}\n"
        f"{view_data_note}\n"
        f"CREATOR'S VIDEOS (sorted by view count):\n{top_section}\n\n"
        f"LOWER PERFORMING VIDEOS:\n{bottom_section}"
    )

    if benchmarks:
        bench_lines = "\n".join(
            f"- [{b.get('viewCount', 0):,} views] \"{b['title']}\" by {b.get('channelTitle', 'unknown creator')}:"
            f" {(b.get('description') or '')[:150]}"
            for b in benchmarks[:10]
        )
        prompt += (
            f"\n\nNICHE BENCHMARK VIDEOS (top-performing public videos in this creator's space — "
            f"data provided because this creator's channel is still growing):\n{bench_lines}\n\n"
            f"Use benchmarks to: (1) identify proven formats the creator hasn't tried, "
            f"(2) surface gaps in the benchmark content this creator could own, "
            f"(3) calibrate content_strengths and recommended_formats against what works at scale."
        )

    try:
        raw = _call_gemini(CONTENT_PATTERN_PROMPT, prompt, max_tokens=2048)
        return _parse_response(raw, creator_handle, "content-patterns")
    except Exception as e:
        logger.error("analyze_content_patterns failed for %s: %s", creator_handle, e)
        return None


def analyze_audience_demands(
    comments_by_video: dict[str, list[str]],
) -> Optional[dict]:
    """
    Extract audience demand signals from {video_title: [comment, ...]} pairs.
    Returns structured demand dict on success, None if no comment data.
    """
    if not comments_by_video:
        return None

    lines: list[str] = []
    for video_title, comments in comments_by_video.items():
        if not comments:
            continue
        lines.append(f"\n[Video: {video_title}]")
        lines.extend(f"  • {c[:120]}" for c in comments[:15])

    if not lines:
        return None

    prompt = "Comments from recent videos:\n" + "\n".join(lines[:200])

    try:
        raw = _call_gemini(AUDIENCE_DEMAND_PROMPT, prompt, max_tokens=2048)
        return _parse_response(raw, "audience-demands", "audience-demands")
    except Exception as e:
        logger.error("analyze_audience_demands failed: %s", e)
        return None


def generate_content_briefs(
    patterns: dict,
    audience: Optional[dict],
    creator_handle: str,
) -> list[dict]:
    """
    Generate 4 content briefs grounded in pattern analysis + audience signals.
    Returns a list of brief dicts (may be empty on failure).
    """
    audience_section = (
        json.dumps(audience, indent=2)
        if audience
        else "No audience comment data available for this creator."
    )

    prompt = (
        f"Creator: @{creator_handle}\n\n"
        f"PERFORMANCE PATTERNS:\n{json.dumps(patterns, indent=2)}\n\n"
        f"AUDIENCE DEMAND SIGNALS:\n{audience_section}"
    )

    try:
        raw = _call_gemini(CONTENT_BRIEF_PROMPT, prompt, max_tokens=8192)
        parsed = _parse_response(raw, creator_handle, "content-briefs")
        if not parsed:
            return []
        briefs = parsed.get("briefs")
        if not isinstance(briefs, list):
            return []
        return [b for b in briefs if isinstance(b, dict)]
    except Exception as e:
        logger.error("generate_content_briefs failed for %s: %s", creator_handle, e)
        return []
