"""
Analytics service — fetches per-video performance data, YouTube comments,
and niche benchmark videos for enriching small-creator analysis.

Reads view/like counts from the Vlog table (already synced during channel scan)
and fetches comment threads + benchmark videos via the YouTube Data API using
the public API key. No OAuth required — all data is public.
"""
import logging
import re
from collections import Counter
from typing import Optional

from app.core.config import settings
from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

_youtube_client: Optional[object] = None

# Words that appear in travel vlog titles but don't identify a niche
_STOP_WORDS = frozenset({
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but",
    "with", "my", "i", "you", "we", "our", "your", "it", "is", "are", "was",
    "were", "be", "been", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "get", "got", "go", "went", "this", "that",
    "what", "how", "when", "where", "why", "which", "who", "all", "just",
    "so", "up", "out", "from", "into", "about", "like", "more", "than",
    "as", "if", "not", "no", "by", "after", "before", "day", "days", "week",
    "weeks", "month", "months", "year", "years", "video", "vlog", "part",
    "new", "vs", "full", "tips", "guide", "travel", "traveler", "traveling",
    "travelling", "episode", "watch", "must", "best", "top", "first", "last",
    "time", "way", "one", "two", "three", "four", "five", "10", "2024", "2025",
    "2023", "things",
})


def _youtube():
    global _youtube_client
    if _youtube_client is None:
        if not settings.YOUTUBE_API_KEY:
            raise RuntimeError("YOUTUBE_API_KEY is not set")
        from googleapiclient.discovery import build
        _youtube_client = build(
            "youtube", "v3",
            developerKey=settings.YOUTUBE_API_KEY,
            cache_discovery=False,
        )
    return _youtube_client


def fetch_vlog_performance(creator_id: str, limit: int = 30) -> list[dict]:
    """
    Return stored vlog metadata + performance stats for the creator.

    Sorted by view count descending. Includes a transcript excerpt (first 3000
    chars of transcriptClean) so Gemini can pattern-match without loading full
    transcripts for every video.
    """
    with PgClient() as db:
        db.execute(
            '''SELECT id, "externalId", title, description,
                      "viewCount", "likeCount", "publishedAt",
                      LEFT("transcriptClean", 3000) AS transcript_excerpt,
                      "processingStatus"
               FROM "Vlog"
               WHERE "creatorId" = %s
               ORDER BY "viewCount" DESC NULLS LAST, "publishedAt" DESC NULLS LAST
               LIMIT %s''',
            (creator_id, limit),
        )
        return [dict(row) for row in (db.fetchall() or [])]


def fetch_video_comments(video_id: str, max_comments: int = 50) -> list[str]:
    """
    Fetch top-level comments for a YouTube video sorted by relevance.
    Returns comment texts. Returns empty list if the API key is missing,
    comments are disabled, or the request fails.
    """
    if not settings.YOUTUBE_API_KEY:
        return []
    try:
        yt = _youtube()
        resp = (
            yt.commentThreads()
            .list(
                part="snippet",
                videoId=video_id,
                maxResults=min(max_comments, 100),
                order="relevance",
                textFormat="plainText",
            )
            .execute()
        )
        comments = []
        for item in resp.get("items", []):
            text = (
                item.get("snippet", {})
                .get("topLevelComment", {})
                .get("snippet", {})
                .get("textDisplay", "")
                .strip()
            )
            if text:
                comments.append(text)
        return comments
    except Exception as e:
        logger.warning("fetch_video_comments failed for video %s: %s", video_id, e)
        return []


def extract_niche_keywords(vlogs: list[dict]) -> str:
    """
    Extract the most representative content keywords from vlog titles.

    Filters common travel-blog stop words and returns the top 5 terms
    joined as a YouTube search query string. Returns empty string if no
    useful keywords can be extracted.
    """
    words: list[str] = []
    for vlog in vlogs:
        tokens = re.findall(r"[a-zA-Z]+", (vlog.get("title") or "").lower())
        words.extend(t for t in tokens if len(t) > 2 and t not in _STOP_WORDS)

    if not words:
        return ""

    freq = Counter(words)
    top_terms = [word for word, _ in freq.most_common(5)]
    return " ".join(top_terms)


def search_niche_benchmarks(query: str, max_results: int = 15) -> list[dict]:
    """
    Search YouTube for top-performing public videos matching the niche query.

    Makes two API calls: search.list (100 units) + videos.list (1 unit) to get
    full statistics for each video. Returns empty list if the API key is missing
    or any request fails.
    """
    if not settings.YOUTUBE_API_KEY or not query:
        return []
    try:
        yt = _youtube()

        search_resp = (
            yt.search()
            .list(
                part="id",
                q=query,
                type="video",
                order="viewCount",
                maxResults=min(max_results, 50),
                relevanceLanguage="en",
                safeSearch="none",
            )
            .execute()
        )

        video_ids = [
            item["id"]["videoId"]
            for item in search_resp.get("items", [])
            if item.get("id", {}).get("videoId")
        ]
        if not video_ids:
            return []

        stats_resp = (
            yt.videos()
            .list(
                part="snippet,statistics",
                id=",".join(video_ids),
            )
            .execute()
        )

        results = []
        for item in stats_resp.get("items", []):
            stats = item.get("statistics", {})
            snippet = item.get("snippet", {})
            results.append({
                "videoId": item["id"],
                "title": snippet.get("title", ""),
                "channelTitle": snippet.get("channelTitle", ""),
                "description": (snippet.get("description") or "")[:200],
                "viewCount": int(stats.get("viewCount") or 0),
                "likeCount": int(stats.get("likeCount") or 0),
            })

        # Sort by view count descending (search API order is approximate)
        results.sort(key=lambda v: v["viewCount"], reverse=True)
        return results

    except Exception as e:
        logger.warning("search_niche_benchmarks failed for query '%s': %s", query, e)
        return []
