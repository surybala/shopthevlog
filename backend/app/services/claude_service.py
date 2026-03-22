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
- Always include at least 3 days with 3-5 activities per day.
- For each destination, include approximate lat/lng coordinates.
- estimated_cost_usd is per-person per day in USD (use realistic estimates; null if truly unknown).
- booking_url should be a real booking link if identifiable, otherwise null.
- YOUR ENTIRE RESPONSE IS THE JSON OBJECT. Nothing before {, nothing after }."""


DESTINATION_EXTRACTION_PROMPT = """Extract all travel destination names from this text. Return ONLY a JSON array of destination strings (countries, cities, regions). Example: ["Tokyo", "Japan", "Kyoto"]. No explanation."""


def generate_itinerary(vlog_id: str, transcript: str, title: str, constraints: Optional[dict] = None) -> bool:
    """
    Generate and persist a shoppable itinerary for a vlog.
    Returns True on success, False on failure.
    """
    db = get_supabase()

    # Build user prompt
    user_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:30000]}"  # ~7,500 tokens
    if constraints:
        user_content += f"\n\nUser constraints: {json.dumps(constraints)}"

    try:
        message = claude.messages.create(
            model="claude-haiku-4-5",
            max_tokens=8192,
            system=ITINERARY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        if message.stop_reason == "max_tokens":
            logger.error(f"Claude hit max_tokens for vlog {vlog_id} — response truncated")
            db.table("vlogs").update({"processing_status": "failed", "processing_error": "Response too long, hit token limit"}).eq("id", vlog_id).execute()
            return False

        raw_response = message.content[0].text.strip()
        logger.debug(f"Claude raw response for vlog {vlog_id} (first 300 chars): {raw_response[:300]}")

        # Strip markdown code fences if Claude wraps the JSON despite instructions
        if raw_response.startswith("```"):
            lines = raw_response.splitlines()
            # Drop first line (```json or ```) and last line (```)
            end = -1 if lines[-1].strip() == "```" else len(lines)
            raw_response = "\n".join(lines[1:end]).strip()

        itinerary_data = json.loads(raw_response)
    except json.JSONDecodeError as e:
        logger.error(f"Claude returned invalid JSON for vlog {vlog_id}: {e}. Raw (first 500): {raw_response[:500] if 'raw_response' in dir() else 'N/A'}")
        db.table("vlogs").update({"processing_status": "failed", "processing_error": f"Claude returned invalid JSON: {e}"}).eq("id", vlog_id).execute()
        return False
    except Exception as e:
        logger.error(f"Claude API error for vlog {vlog_id}: {e}")
        db.table("vlogs").update({"processing_status": "failed", "processing_error": str(e)}).eq("id", vlog_id).execute()
        return False

    # Persist itinerary
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
        db.table("vlogs").update({"processing_status": "failed", "processing_error": "DB write failed"}).eq("id", vlog_id).execute()
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
