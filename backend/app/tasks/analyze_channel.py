"""
Background task: analyze a creator's channel for growth insights.

Pipeline stages:
  1. Fetch stored vlog performance data from DB
  2. Fetch YouTube comments for top 5 vlogs (by view count)
  2.5 Niche benchmarking — for small/growing channels (< 10 vlogs or < 50k top views):
      extract keywords from titles, search YouTube for top niche videos,
      and pass them as context to the pattern analysis stage
  3. Analyze content patterns with Gemini (+ benchmark context when available)
  4. Analyze audience demand signals with Gemini
  5. Generate 4 content briefs with Gemini
  6. Persist ChannelInsight + ContentBrief rows

Mirrors the structure of process_vlog_task — same status helper pattern,
same observability calls, same PgClient usage, same error handling shape.
"""
import json
import logging
import time

from app.core.observability import observability_store
from app.db.pg_client import PgClient
from app.services.analytics_service import (
    fetch_vlog_performance,
    fetch_video_comments,
    extract_niche_keywords,
    search_niche_benchmarks,
)
from app.services.insights_gemini_service import (
    analyze_content_patterns,
    analyze_audience_demands,
    generate_content_briefs,
)

logger = logging.getLogger(__name__)

# Channels below either threshold get niche benchmark enrichment
_BENCHMARK_MAX_VLOGS = 10
_BENCHMARK_MAX_VIEWS = 50_000


# ─── DB helpers ───────────────────────────────────────────────────────────────

def _upsert_insight(creator_id: str) -> str:
    """Ensure a ChannelInsight row exists for this creator; return its id."""
    with PgClient() as db:
        db.execute(
            '''INSERT INTO "ChannelInsight" (id, "creatorId", status, "createdAt", "updatedAt")
               VALUES (gen_random_uuid()::text, %s, 'QUEUED', NOW(), NOW())
               ON CONFLICT ("creatorId") DO UPDATE
               SET status = 'QUEUED', "updatedAt" = NOW()
               RETURNING id''',
            (creator_id,),
        )
        return db.fetchone()["id"]


def _update_insight_status(creator_id: str, status: str) -> None:
    with PgClient() as db:
        db.execute(
            '''UPDATE "ChannelInsight"
               SET status = %s, "updatedAt" = NOW()
               WHERE "creatorId" = %s''',
            (status, creator_id),
        )


def _save_insight_results(
    insight_id: str,
    creator_id: str,
    patterns: dict,
    audience: dict | None,
    video_count: int,
    used_benchmarks: bool = False,
    benchmark_video_count: int = 0,
) -> None:
    with PgClient() as db:
        db.execute(
            '''UPDATE "ChannelInsight"
               SET status = 'COMPLETE',
                   "channelNiche" = %s,
                   "topPatterns" = %s,
                   "audienceDemands" = %s,
                   "analyzedVideoCount" = %s,
                   "usedBenchmarks" = %s,
                   "benchmarkVideoCount" = %s,
                   "analyzedAt" = NOW(),
                   "updatedAt" = NOW()
               WHERE id = %s''',
            (
                patterns.get("channel_niche"),
                json.dumps(patterns),
                json.dumps(audience) if audience else None,
                video_count,
                used_benchmarks,
                benchmark_video_count,
                insight_id,
            ),
        )


def _save_briefs(insight_id: str, creator_id: str, briefs: list[dict]) -> None:
    with PgClient() as db:
        db.execute(
            'DELETE FROM "ContentBrief" WHERE "insightId" = %s',
            (insight_id,),
        )
        for brief in briefs:
            db.execute(
                '''INSERT INTO "ContentBrief" (
                    id, "creatorId", "insightId",
                    title, "hookIdeas", "contentOutline",
                    "trendSignal", "audienceSignal",
                    "estimatedScore", reasoning,
                    "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid()::text, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    NOW(), NOW()
                )''',
                (
                    creator_id,
                    insight_id,
                    brief.get("title", "Untitled Brief"),
                    json.dumps(brief.get("hook_ideas") or []),
                    json.dumps(brief.get("content_outline") or []),
                    brief.get("trend_signal"),
                    brief.get("audience_signal"),
                    int(brief.get("estimated_score") or 50),
                    brief.get("reasoning"),
                ),
            )


# ─── Task entry point ─────────────────────────────────────────────────────────

async def analyze_channel_task(creator_id: str, creator_handle: str) -> None:
    """Run the full channel analysis pipeline for a creator."""
    logger.info("Starting channel analysis for creator %s (@%s)", creator_id, creator_handle)
    started_at = time.perf_counter()

    try:
        insight_id = _upsert_insight(creator_id)
        _update_insight_status(creator_id, "ANALYZING")

        # Stage 1: load performance data from DB
        vlogs = fetch_vlog_performance(creator_id, limit=30)
        if not vlogs:
            logger.warning("No vlog data found for creator %s — skipping analysis", creator_id)
            _update_insight_status(creator_id, "FAILED")
            observability_store.record(
                kind="pipeline", name="analyze_channel",
                status="failed", detail="no_vlog_data",
            )
            return

        # Stage 2: fetch comments for the top 5 vlogs by view count
        top_vlogs = sorted(vlogs, key=lambda v: v.get("viewCount") or 0, reverse=True)[:5]
        comments_by_video: dict[str, list[str]] = {}
        for v in top_vlogs:
            if v.get("externalId"):
                comments = fetch_video_comments(v["externalId"], max_comments=40)
                if comments:
                    comments_by_video[v["title"]] = comments

        # Stage 2.5: niche benchmarking for small / growing channels
        benchmark_vlogs: list[dict] = []
        used_benchmarks = False
        benchmark_video_count = 0

        max_views = max((v.get("viewCount") or 0 for v in vlogs), default=0)
        needs_benchmarks = len(vlogs) < _BENCHMARK_MAX_VLOGS or max_views < _BENCHMARK_MAX_VIEWS

        if needs_benchmarks:
            keywords = extract_niche_keywords(vlogs)
            if keywords:
                logger.info(
                    "Fetching niche benchmarks for creator %s (query: '%s')", creator_id, keywords
                )
                benchmark_vlogs = search_niche_benchmarks(keywords, max_results=15)
                if benchmark_vlogs:
                    used_benchmarks = True
                    benchmark_video_count = len(benchmark_vlogs)
                    observability_store.record(
                        kind="pipeline", name="analyze_channel",
                        status="benchmark_fetched",
                        detail=f"{benchmark_video_count}_videos",
                    )

        # Stage 3: content pattern analysis
        patterns = analyze_content_patterns(
            vlogs, creator_handle,
            benchmarks=benchmark_vlogs if benchmark_vlogs else None,
        )
        if not patterns:
            logger.warning("Pattern analysis returned no result for creator %s", creator_id)
            _update_insight_status(creator_id, "FAILED")
            observability_store.record(
                kind="pipeline", name="analyze_channel",
                status="failed", detail="pattern_analysis_empty",
            )
            return

        # Stage 4: audience demand analysis (optional — comment fetch may be empty)
        audience = analyze_audience_demands(comments_by_video) if comments_by_video else None

        # Stage 5: generate content briefs
        briefs = generate_content_briefs(patterns, audience, creator_handle)

        # Stage 6: persist
        _save_insight_results(
            insight_id, creator_id, patterns, audience, len(vlogs),
            used_benchmarks=used_benchmarks,
            benchmark_video_count=benchmark_video_count,
        )
        if briefs:
            _save_briefs(insight_id, creator_id, briefs)

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "Channel analysis complete for creator %s — %d briefs in %.0fms (benchmarks=%s)",
            creator_id, len(briefs), elapsed_ms, used_benchmarks,
        )
        observability_store.record(
            kind="pipeline", name="analyze_channel",
            status="success", duration_ms=elapsed_ms,
        )

    except Exception as error:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "Unexpected error in analyze_channel_task for creator %s: %s", creator_id, error
        )
        observability_store.record(
            kind="pipeline", name="analyze_channel",
            status="failed", duration_ms=elapsed_ms,
            detail=type(error).__name__,
        )
        try:
            _update_insight_status(creator_id, "FAILED")
        except Exception:
            pass
