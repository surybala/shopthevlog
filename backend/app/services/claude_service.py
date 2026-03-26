"""
Claude API integration for itinerary generation and destination extraction.

Uses claude-haiku-4-5 to parse vlog transcripts into structured, shoppable itineraries.
"""
import json
import logging
from typing import Optional

import anthropic

from app.core.config import settings
from app.db.client import get_supabase

logger = logging.getLogger(__name__)
claude = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

# ─── Prompts ──────────────────────────────────────────────────────────────────

ITINERARY_SYSTEM_PROMPT = """You are a professional travel itinerary expert. Given a travel vlog title and transcript (or description), create a detailed day-by-day itinerary.

CRITICAL: Your entire response must be a single valid JSON object. Do not use markdown code blocks, backticks, or any other wrapper. Start your response with { and end with }.

JSON schema (follow exactly):
{
  "title": "string",
  "summary": "string (2-3 sentence overview)",
  "total_days": integer,
  "destinations": ["string"],
  "estimated_budget_usd": integer | null,
  "days": [
    {
      "day_number": integer,
      "location": "string",
      "title": "string",
      "description": "string",
      "activities": [
        {
          "order_index": integer,
          "type": "activity|meal|accommodation|transport|note",
          "name": "string",
          "description": "string",
          "location_name": "string | null",
          "lat": number | null,
          "lng": number | null,
          "estimated_cost_usd": integer | null,
          "duration_minutes": integer | null,
          "booking_url": "string | null",
          "image_url": "string | null"
        }
      ]
    }
  ]
}

Rules:
- If the input is a full transcript, extract locations/activities mentioned.
- If the input is a short title or description, infer the destination(s) and generate a realistic sample itinerary for that location (assume a typical tourist trip).
- Always include at least 3 days with 2-3 activities per day.
- For each destination, include approximate lat/lng coordinates.
- estimated_cost_usd is per-person per day in USD (use realistic estimates; null if truly unknown).
- booking_url should be a real booking link if identifiable, otherwise null.

TOKEN BUDGET — follow these limits to avoid truncation:
- Maximum 10 days total (group multiple destinations into combined days if needed).
- Exactly 4 activities per day — no more, no fewer.
- Keep every "description" field to 1-2 sentences (under 30 words).
- Set unknown fields to null; never write "N/A", "unknown", or empty strings.
- YOUR ENTIRE RESPONSE IS THE JSON OBJECT. Nothing before {, nothing after }."""

# Compact fallback — used when the full prompt hits max_tokens
ITINERARY_SYSTEM_PROMPT_COMPACT = """You are a travel itinerary expert. Return ONE valid JSON object (no markdown, no backticks). Start with { end with }.

Schema:
{"title":"string","summary":"string","total_days":integer,"destinations":["string"],"estimated_budget_usd":integer|null,"days":[{"day_number":integer,"location":"string","title":"string","description":"string","activities":[{"order_index":integer,"type":"activity|meal|accommodation|transport|note","name":"string","description":"string","location_name":"string|null","lat":number|null,"lng":number|null,"estimated_cost_usd":integer|null,"duration_minutes":integer|null,"booking_url":null,"image_url":null}]}]}

Strict limits to keep response small:
- Exactly 5 days total.
- Exactly 3 activities per day.
- Each description: one sentence, under 15 words.
- All optional fields set to null.
- YOUR ENTIRE RESPONSE IS THE JSON OBJECT."""

DESTINATION_EXTRACTION_PROMPT = """Extract all travel destination names from this text. Return ONLY a JSON array of destination strings (countries, cities, regions). Example: ["Tokyo", "Japan", "Kyoto"]. No explanation."""

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _strip_code_fences(text: str) -> str:
    """Remove markdown ``` wrappers that some models add despite instructions."""
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    # Find the closing fence (last line that is exactly ```)
    end = len(lines)
    for i in range(len(lines) - 1, 0, -1):
        if lines[i].strip() == "```":
            end = i
            break
    # Drop first line (```json or ```) and everything after the closing fence
    return "\n".join(lines[1:end]).strip()


def _call_claude(system: str, user_content: str, max_tokens: int) -> anthropic.types.Message:
    return claude.messages.create(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )


def _parse_response(message: anthropic.types.Message, vlog_id: str, attempt: str) -> Optional[dict]:
    """
    Extract and parse JSON from a Claude message.
    Returns the parsed dict or None on failure.
    Logs all errors with vlog_id + attempt context.
    """
    if message.stop_reason == "max_tokens":
        logger.warning(
            f"Claude hit max_tokens on {attempt} attempt for vlog {vlog_id} "
            f"(used {message.usage.output_tokens} output tokens)"
        )
        return None

    raw = message.content[0].text.strip()
    logger.debug(
        f"Claude raw response [{attempt}] for vlog {vlog_id} "
        f"(first 400 chars): {raw[:400]}"
    )

    cleaned = _strip_code_fences(raw)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(
            f"Claude returned invalid JSON [{attempt}] for vlog {vlog_id}: {e}. "
            f"Raw (first 600 chars): {raw[:600]}"
        )
        return None


# ─── Public API ──────────────────────────────────────────────────────────────

def generate_itinerary(vlog_id: str, transcript: str, title: str, constraints: Optional[dict] = None) -> bool:
    """
    Generate and persist a shoppable itinerary for a vlog.
    Returns True on success, False on failure.

    Strategy:
    1. Primary call: full prompt, transcript up to ~7 500 tokens, max_tokens=16000.
    2. If max_tokens hit OR JSON parse fails: compact fallback with tighter limits.
    3. If both fail: mark vlog as failed and return False.
    """
    db = get_supabase()

    # Guard: skip if an itinerary already exists for this vlog.
    existing = db.table("itineraries").select("id").eq("vlog_id", vlog_id).limit(1).execute()
    if existing.data:
        logger.info(f"Itinerary already exists for vlog {vlog_id}, skipping Claude call")
        db.table("vlogs").update({"processing_status": "ready"}).eq("id", vlog_id).execute()
        return True

    # ── Attempt 1: full prompt ────────────────────────────────────────────────
    user_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:30000]}"  # ~7 500 tokens
    if constraints:
        user_content += f"\n\nUser constraints: {json.dumps(constraints)}"

    itinerary_data: Optional[dict] = None
    try:
        msg = _call_claude(ITINERARY_SYSTEM_PROMPT, user_content, max_tokens=16000)
        itinerary_data = _parse_response(msg, vlog_id, "primary")
    except Exception as e:
        logger.error(f"Claude API error (primary) for vlog {vlog_id}: {e}")

    # ── Attempt 2: compact fallback ───────────────────────────────────────────
    if itinerary_data is None:
        logger.info(f"Retrying with compact prompt for vlog {vlog_id}")
        compact_content = (
            f"Vlog title: {title}\n\n"
            f"Transcript excerpt:\n{transcript[:8000]}"
        )
        try:
            msg2 = _call_claude(ITINERARY_SYSTEM_PROMPT_COMPACT, compact_content, max_tokens=4096)
            itinerary_data = _parse_response(msg2, vlog_id, "compact")
        except Exception as e:
            logger.error(f"Claude API error (compact) for vlog {vlog_id}: {e}")

    if itinerary_data is None:
        db.table("vlogs").update({
            "processing_status": "failed",
            "processing_error": "Could not generate a valid itinerary after two attempts. Try again.",
        }).eq("id", vlog_id).execute()
        return False

    # ── Persist itinerary ─────────────────────────────────────────────────────
    try:
        itin_resp = db.table("itineraries").insert({
            "vlog_id": vlog_id,
            "title": itinerary_data.get("title", ""),
            "summary": itinerary_data.get("summary"),
            "total_days": itinerary_data.get("total_days"),
            "destinations": itinerary_data.get("destinations", []),
            "estimated_budget_usd": itinerary_data.get("estimated_budget_usd"),
            "claude_model": "claude-haiku-4-5",
            "raw_claude_response": itinerary_data,
        }).execute()

        itinerary_id = itin_resp.data[0]["id"]

        for day in itinerary_data.get("days", []):
            day_resp = db.table("itinerary_days").insert({
                "itinerary_id": itinerary_id,
                "day_number": day["day_number"],
                "location": day.get("location"),
                "title": day.get("title"),
                "description": day.get("description"),
            }).execute()

            day_id = day_resp.data[0]["id"]

            for activity in day.get("activities", []):
                db.table("itinerary_activities").insert({
                    "day_id": day_id,
                    "order_index": activity.get("order_index", 0),
                    "type": activity.get("type", "activity"),
                    "name": activity.get("name", ""),
                    "description": activity.get("description"),
                    "location_name": activity.get("location_name"),
                    "lat": activity.get("lat"),
                    "lng": activity.get("lng"),
                    "estimated_cost_usd": activity.get("estimated_cost_usd"),
                    "duration_minutes": activity.get("duration_minutes"),
                    "booking_url": activity.get("booking_url"),
                    "image_url": activity.get("image_url"),
                }).execute()

        # Update vlog status and extracted destinations
        destinations = itinerary_data.get("destinations", [])
        db.table("vlogs").update({
            "processing_status": "ready",
            "destinations": destinations,
        }).eq("id", vlog_id).execute()

        logger.info(f"Itinerary generated for vlog {vlog_id}, itinerary_id={itinerary_id}")
        return True

    except Exception as e:
        logger.error(f"DB write failed after Claude response for vlog {vlog_id}: {e}")
        db.table("vlogs").update({
            "processing_status": "failed",
            "processing_error": "DB write failed after successful Claude response",
        }).eq("id", vlog_id).execute()
        return False


def extract_destinations(transcript: str, title: str) -> list[str]:
    """Lightweight Claude call to extract destination names for tagging."""
    try:
        text = f"Title: {title}\n\n{transcript[:4000]}"
        message = claude.messages.create(
            model="claude-haiku-4-5",
            max_tokens=256,
            messages=[{"role": "user", "content": f"{DESTINATION_EXTRACTION_PROMPT}\n\nText: {text}"}],
        )
        return json.loads(message.content[0].text)
    except Exception as e:
        logger.warning(f"extract_destinations failed: {e}")
        return []
