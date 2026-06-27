"""
Niche taxonomy, shared benchmark cache, and trend aggregation (Phase 2).

A creator's free-text niche becomes a *canonical* Niche row so signal compounds
across creators:
  - one shared, TTL'd benchmark/peer cache per niche (cost control + consistency)
  - per-niche rolling trend aggregates derived from real benchmark velocity,
    not from an LLM's stale training data

All DB access goes through PgClient with raw SQL, matching the rest of the
backend. Gemini calls reuse the shared helpers from gemini_service.
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.db.pg_client import PgClient
from app.services.gemini_service import _call_gemini, _parse_response

logger = logging.getLogger(__name__)

_CACHE_TTL_HOURS = 24


# ─── Helpers ────────────────────────────────────────────────────────────────

def slugify_niche(label: str) -> str:
    """Normalise a niche label into a stable slug used as the canonical key."""
    slug = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")
    return slug[:80] or "general-travel"


def _loads(value) -> list:
    """Tolerant JSON loader for columns that may be str or already-parsed."""
    if value is None:
        return []
    if isinstance(value, (list, dict)):
        return value  # type: ignore[return-value]
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []


def _as_datetime(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


# ─── Niche classification ───────────────────────────────────────────────────

NICHE_CLASSIFY_PROMPT = """You are a taxonomist for travel YouTube channels.
Given a creator's video titles and a list of EXISTING canonical niches, decide which
single niche this creator belongs to. Reuse an existing niche when it genuinely fits;
only propose a new one when none is close.

Return ONE valid JSON object only. No markdown, no backticks.

Schema:
{
  "slug": "string — kebab-case canonical key; reuse an existing slug when it fits",
  "label": "string — human-readable niche name (e.g. 'budget backpacking Southeast Asia')",
  "keywords": ["string — 3 to 6 defining keywords for this niche"]
}

Rules:
- Strongly prefer reusing an existing slug when the creator clearly fits it
- Keep niches meaningfully distinct — do not split hairs (e.g. 'japan travel' vs 'tokyo travel')
- slug must be kebab-case, lowercase, no spaces
"""


def list_existing_niches() -> list[dict]:
    with PgClient() as db:
        db.execute('SELECT id, slug, label FROM "Niche" ORDER BY label')
        return [dict(r) for r in (db.fetchall() or [])]


def classify_niche(vlogs: list[dict], creator_handle: str, existing: list[dict]) -> dict:
    """Map a creator into a canonical niche via Gemini. Returns {} on failure."""
    titles = [str(v.get("title") or "") for v in vlogs if v.get("title")][:30]
    if not titles:
        return {}

    existing_section = (
        "\n".join(f"- {n['slug']}: {n['label']}" for n in existing[:60])
        if existing
        else "(none yet — propose the first niche)"
    )
    prompt = (
        f"EXISTING NICHES:\n{existing_section}\n\n"
        f"CREATOR @{creator_handle} VIDEO TITLES:\n" + "\n".join(f"- {t}" for t in titles)
    )
    try:
        raw = _call_gemini(NICHE_CLASSIFY_PROMPT, prompt, max_tokens=512)
        parsed = _parse_response(raw, creator_handle or "niche-classify", "niche-classify")
        if parsed and isinstance(parsed, dict):
            return parsed
    except Exception as e:
        logger.error("classify_niche failed for %s: %s", creator_handle, e)
    return {}


def get_or_create_niche(slug: str, label: str, keywords: list[str]) -> Optional[str]:
    if not slug:
        return None
    with PgClient() as db:
        db.execute(
            '''INSERT INTO "Niche" (id, slug, label, keywords, "createdAt", "updatedAt")
               VALUES (gen_random_uuid()::text, %s, %s, %s, NOW(), NOW())
               ON CONFLICT (slug) DO UPDATE
               SET label = EXCLUDED.label, keywords = EXCLUDED.keywords, "updatedAt" = NOW()
               RETURNING id''',
            (slug, label or slug, keywords or []),
        )
        row = db.fetchone()
        return row["id"] if row else None


def assign_creator_niche(creator_id: str, niche_id: str) -> None:
    with PgClient() as db:
        db.execute(
            'UPDATE "Creator" SET "nicheId" = %s WHERE id = %s',
            (niche_id, creator_id),
        )


def classify_and_assign_niche(
    creator_id: str,
    creator_handle: str,
    vlogs: list[dict],
    niche_hint: str = "",
) -> Optional[str]:
    """
    Full niche resolution: classify → canonicalise → assign to creator.
    Best-effort; returns the niche id or None and never raises.
    """
    try:
        existing = list_existing_niches()
        result = classify_niche(vlogs, creator_handle, existing)
        label = (result.get("label") or niche_hint or "").strip()
        slug = slugify_niche(result.get("slug") or label or niche_hint)
        if not label:
            label = slug.replace("-", " ")
        keywords = [str(k) for k in (result.get("keywords") or []) if k]
        niche_id = get_or_create_niche(slug, label, keywords)
        if niche_id:
            assign_creator_niche(creator_id, niche_id)
        return niche_id
    except Exception as e:
        logger.warning("classify_and_assign_niche failed for %s: %s", creator_id, e)
        return None


# ─── Shared benchmark cache ─────────────────────────────────────────────────

def load_cached_benchmarks(niche_id: str) -> Optional[dict]:
    """Return {'videos', 'peers'} if a fresh cache exists for this niche, else None."""
    if not niche_id:
        return None
    try:
        with PgClient() as db:
            db.execute(
                'SELECT "videosJson", "peersJson", "expiresAt" FROM "NicheBenchmarkCache" WHERE "nicheId" = %s',
                (niche_id,),
            )
            row = db.fetchone()
        if not row:
            return None
        expires = _as_datetime(row.get("expiresAt"))
        if expires and expires < datetime.now(timezone.utc):
            return None
        return {"videos": _loads(row.get("videosJson")), "peers": _loads(row.get("peersJson"))}
    except Exception as e:
        logger.warning("load_cached_benchmarks failed for niche %s: %s", niche_id, e)
        return None


def save_benchmark_cache(
    niche_id: str,
    query: str,
    videos: list[dict],
    peers: list[dict],
    ttl_hours: int = _CACHE_TTL_HOURS,
) -> None:
    if not niche_id:
        return
    expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    try:
        with PgClient() as db:
            db.execute(
                '''INSERT INTO "NicheBenchmarkCache"
                     (id, "nicheId", query, "videosJson", "peersJson", "fetchedAt", "expiresAt")
                   VALUES (gen_random_uuid()::text, %s, %s, %s, %s, NOW(), %s)
                   ON CONFLICT ("nicheId") DO UPDATE
                   SET query = EXCLUDED.query,
                       "videosJson" = EXCLUDED."videosJson",
                       "peersJson" = EXCLUDED."peersJson",
                       "fetchedAt" = NOW(),
                       "expiresAt" = EXCLUDED."expiresAt"''',
                (niche_id, query, json.dumps(videos or []), json.dumps(peers or []), expires),
            )
    except Exception as e:
        logger.warning("save_benchmark_cache failed for niche %s: %s", niche_id, e)


# ─── Niche trend aggregation ────────────────────────────────────────────────

NICHE_TREND_PROMPT = """You are a YouTube trend analyst. You receive recent high-velocity
videos (ranked by views/day) from a single travel niche. Cluster them into the
distinct content TOPICS that are driving views right now, and judge each topic's momentum.

Return ONE valid JSON object only. No markdown, no backticks.

Schema:
{
  "trends": [
    {
      "topic": "string — the content topic (e.g. 'Japan 7-day itineraries', 'budget hostel tours')",
      "format": "string | null — the format if clear (e.g. 'day-by-day vlog', 'cost breakdown')",
      "momentum": "RISING | STEADY | SATURATED",
      "score": integer (0-100, how strong/hot this topic is right now),
      "evidence": "string — one short phrase citing the signal (e.g. '3 videos >50k views/day')"
    }
  ]
}

Rules:
- 3 to 6 trends, each genuinely supported by the videos provided
- momentum RISING = high views/day on recent uploads; SATURATED = many similar videos competing
- Never invent topics not represented in the videos
"""


def compute_niche_trends(benchmarks: list[dict], niche_label: str = "") -> list[dict]:
    """Derive ranked niche trends from benchmark videos via Gemini. [] on failure."""
    if not benchmarks:
        return []

    def _line(b: dict) -> str:
        velocity = b.get("viewVelocity")
        vel = f", {velocity:,.0f} views/day" if isinstance(velocity, (int, float)) else ""
        return f"- [{b.get('viewCount', 0):,} views{vel}] {b.get('title', '')}"

    prompt = (
        (f"Niche: {niche_label}\n\n" if niche_label else "")
        + "RECENT HIGH-VELOCITY VIDEOS IN THIS NICHE:\n"
        + "\n".join(_line(b) for b in benchmarks[:15])
    )
    try:
        raw = _call_gemini(NICHE_TREND_PROMPT, prompt, max_tokens=2048)
        parsed = _parse_response(raw, niche_label or "niche-trends", "niche-trends")
        if not parsed:
            return []
        trends = parsed.get("trends")
        return [t for t in trends if isinstance(t, dict)] if isinstance(trends, list) else []
    except Exception as e:
        logger.error("compute_niche_trends failed for %s: %s", niche_label, e)
        return []


def _normalise_momentum(value) -> str:
    candidate = str(value or "").strip().upper()
    return candidate if candidate in {"RISING", "STEADY", "SATURATED"} else "STEADY"


def store_niche_trends(niche_id: str, trends: list[dict]) -> None:
    """Replace this niche's trend rows with the freshly computed set."""
    if not niche_id:
        return
    try:
        with PgClient() as db:
            db.execute('DELETE FROM "NicheTrend" WHERE "nicheId" = %s', (niche_id,))
            for t in trends:
                topic = str(t.get("topic") or "").strip()
                if not topic:
                    continue
                db.execute(
                    '''INSERT INTO "NicheTrend"
                         (id, "nicheId", topic, format, momentum, score, evidence, "computedAt")
                       VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, NOW())''',
                    (
                        niche_id,
                        topic,
                        t.get("format"),
                        _normalise_momentum(t.get("momentum")),
                        float(t.get("score") or 0),
                        json.dumps({"evidence": t.get("evidence")}) if t.get("evidence") else None,
                    ),
                )
    except Exception as e:
        logger.warning("store_niche_trends failed for niche %s: %s", niche_id, e)


def compute_and_store_niche_trends(
    niche_id: str,
    benchmarks: list[dict],
    niche_label: str = "",
) -> list[dict]:
    """Compute niche trends from benchmarks and persist them. Returns the trends."""
    trends = compute_niche_trends(benchmarks, niche_label)
    if trends and niche_id:
        store_niche_trends(niche_id, trends)
    return trends


def fetch_niche_trends(niche_id: str, limit: int = 8) -> list[dict]:
    """Read the latest stored trends for a niche (for prompts / UI)."""
    if not niche_id:
        return []
    try:
        with PgClient() as db:
            db.execute(
                '''SELECT topic, format, momentum, score, evidence
                   FROM "NicheTrend"
                   WHERE "nicheId" = %s
                   ORDER BY score DESC
                   LIMIT %s''',
                (niche_id, limit),
            )
            return [dict(r) for r in (db.fetchall() or [])]
    except Exception as e:
        logger.warning("fetch_niche_trends failed for niche %s: %s", niche_id, e)
        return []
