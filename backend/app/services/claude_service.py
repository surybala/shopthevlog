"""
Claude API integration for itinerary generation and destination extraction.

Uses claude-sonnet-4-6 to parse vlog transcripts into structured, shoppable itineraries.
"""
import json
import logging
from typing import Optional

import anthropic

from app.core.config import settings
from app.db.client import get_supabase

logger = logging.getLogger(__name__)
claude = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

ITINERARY_SYSTEM_PROMPT = """You are a professional travel itinerary expert. Given a travel vlog transcript and metadata, extract a complete day-by-day itinerary.

Output ONLY valid JSON matching this schema exactly (no markdown, no explanation):
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
- Include all mentioned locations, hotels, restaurants, and activities.
- For each destination, try to provide approximate lat/lng coordinates.
- estimated_cost_usd should be per-person cost in USD (null if unknown).
- If the vlog spans multiple cities, create a separate day entry for each major location.
- booking_url should be a direct booking link if clearly identifiable (hotel website, booking.com, etc.) or null.
- Output ONLY the JSON object. No preamble, no explanation."""


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
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=ITINERARY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_response = message.content[0].text
        itinerary_data = json.loads(raw_response)
    except json.JSONDecodeError as e:
        logger.error(f"Claude returned invalid JSON for vlog {vlog_id}: {e}")
        db.table("vlogs").update({"processing_status": "failed", "processing_error": "Claude returned invalid JSON"}).eq("id", vlog_id).execute()
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
            "claude_model": "claude-sonnet-4-6",
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
            model="claude-sonnet-4-6",
            max_tokens=256,
            messages=[{"role": "user", "content": f"{DESTINATION_EXTRACTION_PROMPT}\n\nText: {text}"}],
        )
        return json.loads(message.content[0].text)
    except Exception as e:
        logger.warning(f"extract_destinations failed: {e}")
        return []
