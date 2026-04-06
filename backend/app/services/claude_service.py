"""
Claude API integration for Trip Kit generation from vlog transcripts.
Writes to TripKit / ItineraryDay / DayActivity / TripKitsOnVlogs tables.
"""
import hashlib
import json
import logging
import re
from typing import Optional

import anthropic

from app.core.config import settings
from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)
claude = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

# ─── Prompts ──────────────────────────────────────────────────────────────────

ITINERARY_SYSTEM_PROMPT = """You are a professional travel itinerary expert. Given a travel vlog title and transcript, create a detailed day-by-day itinerary.

CRITICAL: Your entire response must be a single valid JSON object. No markdown, no backticks. Start with { end with }.

JSON schema:
{
  "title": "string",
  "summary": "string (2-3 sentences)",
  "total_days": integer,
  "destinations": ["city name strings"],
  "countries": ["country name strings"],
  "primary_city": "string",
  "estimated_budget_usd": integer | null,
  "days": [
    {
      "day_number": integer,
      "city": "string",
      "country": "string",
      "title": "string",
      "summary": "string",
      "activities": [
        {
          "sort_order": integer,
          "type": "ACCOMMODATION|FOOD|TOUR|ADVENTURE|CULTURAL|WELLNESS|NIGHTLIFE|TRANSPORT|ATTRACTION|OTHER",
          "title": "string",
          "description": "string (max 30 words)",
          "time": "HH:MM or null",
          "latitude": number | null,
          "longitude": number | null,
          "image_url": null
        }
      ]
    }
  ]
}

Rules:
- Extract all locations and activities mentioned in the transcript.
- At least 3 days, max 10 days. Exactly 4 activities per day.
- Keep descriptions under 30 words.
- YOUR ENTIRE RESPONSE IS THE JSON OBJECT."""

ITINERARY_COMPACT_PROMPT = """Travel itinerary expert. ONE valid JSON object only, no markdown.

{"title":"string","summary":"string","total_days":integer,"destinations":["string"],"countries":["string"],"primary_city":"string","estimated_budget_usd":null,"days":[{"day_number":integer,"city":"string","country":"string","title":"string","summary":"string","activities":[{"sort_order":integer,"type":"ATTRACTION","title":"string","description":"string","time":null,"latitude":null,"longitude":null,"image_url":null}]}]}

5 days max, 3 activities per day, one-sentence descriptions. JSON ONLY."""

DESTINATION_EXTRACTION_PROMPT = """Extract all travel destination names from this text. Return ONLY a JSON array of strings. Example: ["Tokyo", "Japan", "Kyoto"]. No explanation."""


def _slugify(title: str, creator_id: str) -> str:
    base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:50]
    suffix = hashlib.md5(f"{creator_id}{title}".encode()).hexdigest()[:6]
    return f"{base}-{suffix}"


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    end = len(lines)
    for i in range(len(lines) - 1, 0, -1):
        if lines[i].strip() == "```":
            end = i
            break
    return "\n".join(lines[1:end]).strip()


def _call_claude(system: str, user_content: str, max_tokens: int) -> anthropic.types.Message:
    return claude.messages.create(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )


def _parse_response(message: anthropic.types.Message, vlog_id: str, attempt: str) -> Optional[dict]:
    if message.stop_reason == "max_tokens":
        logger.warning(f"Claude hit max_tokens on {attempt} for vlog {vlog_id}")
        return None
    raw = message.content[0].text.strip()
    cleaned = _strip_code_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"Claude invalid JSON [{attempt}] for vlog {vlog_id}: {e}. Raw: {raw[:400]}")
        return None


def generate_trip_kit(vlog_id: str, transcript: str, title: str, creator_id: str) -> bool:
    """
    Generate and persist a TripKit for a vlog.
    Returns True on success.
    """
    # Guard: skip if TripKit already exists for this vlog
    with PgClient() as db:
        db.execute(
            'SELECT "tripKitId" FROM "TripKitsOnVlogs" WHERE "vlogId" = %s LIMIT 1',
            (vlog_id,)
        )
        existing = db.fetchone()
    if existing:
        logger.info(f"TripKit already exists for vlog {vlog_id}, skipping")
        _mark_vlog_complete(vlog_id)
        return True

    # Attempt 1: full prompt
    user_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:30000]}"
    itinerary_data: Optional[dict] = None
    try:
        msg = _call_claude(ITINERARY_SYSTEM_PROMPT, user_content, max_tokens=16000)
        itinerary_data = _parse_response(msg, vlog_id, "primary")
    except Exception as e:
        logger.error(f"Claude API error (primary) for vlog {vlog_id}: {e}")

    # Attempt 2: compact fallback
    if itinerary_data is None:
        logger.info(f"Retrying with compact prompt for vlog {vlog_id}")
        try:
            compact_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:8000]}"
            msg2 = _call_claude(ITINERARY_COMPACT_PROMPT, compact_content, max_tokens=4096)
            itinerary_data = _parse_response(msg2, vlog_id, "compact")
        except Exception as e:
            logger.error(f"Claude API error (compact) for vlog {vlog_id}: {e}")

    if itinerary_data is None:
        _mark_vlog_failed(vlog_id)
        return False

    try:
        slug = _slugify(itinerary_data.get("title", title), creator_id)
        countries = itinerary_data.get("countries") or itinerary_data.get("destinations") or []
        cities = itinerary_data.get("destinations") or []
        primary_city = itinerary_data.get("primary_city") or (cities[0] if cities else None)
        budget = itinerary_data.get("estimated_budget_usd")

        with PgClient() as db:
            # Insert TripKit
            db.execute(
                '''INSERT INTO "TripKit" (
                    id, "creatorId", title, slug, description,
                    countries, cities, "primaryCity",
                    "durationDays", "estimatedBudgetLow", "estimatedBudgetHigh",
                    "isPublished", "isFeatured", "isAiGenerated",
                    "viewCount", "saveCount", "clickCount", "conversionCount",
                    "totalLinkCount", "estimatedEarnings",
                    "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid()::text, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    false, false, true,
                    0, 0, 0, 0, 0, 0,
                    NOW(), NOW()
                ) RETURNING id''',
                (
                    creator_id,
                    itinerary_data.get("title", title),
                    slug,
                    itinerary_data.get("summary"),
                    countries,
                    cities,
                    primary_city,
                    itinerary_data.get("total_days"),
                    budget,
                    budget,
                )
            )
            kit_row = db.fetchone()
            kit_id = kit_row["id"]

            # Link vlog → kit
            db.execute(
                'INSERT INTO "TripKitsOnVlogs" ("tripKitId", "vlogId") VALUES (%s, %s)',
                (kit_id, vlog_id)
            )

            # Insert days + activities
            for day in itinerary_data.get("days", []):
                db.execute(
                    '''INSERT INTO "ItineraryDay" (
                        id, "tripKitId", "dayNumber", title, summary, city, country, tips
                    ) VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id''',
                    (
                        kit_id,
                        day.get("day_number", 1),
                        day.get("title", f"Day {day.get('day_number', 1)}"),
                        day.get("summary"),
                        day.get("city"),
                        day.get("country"),
                        [],
                    )
                )
                day_id = db.fetchone()["id"]

                for activity in day.get("activities", []):
                    act_type = activity.get("type", "OTHER")
                    # Ensure type is a valid ActivityType enum value
                    valid_types = {
                        "ACCOMMODATION", "FOOD", "TOUR", "ADVENTURE",
                        "CULTURAL", "WELLNESS", "NIGHTLIFE", "TRANSPORT",
                        "ATTRACTION", "OTHER"
                    }
                    if act_type not in valid_types:
                        act_type = "OTHER"

                    db.execute(
                        '''INSERT INTO "DayActivity" (
                            id, "dayId", "sortOrder", time, title, description,
                            type, "imageUrl", latitude, longitude
                        ) VALUES (
                            gen_random_uuid()::text, %s, %s, %s, %s, %s,
                            %s::"ActivityType", %s, %s, %s
                        )''',
                        (
                            day_id,
                            activity.get("sort_order", 0),
                            activity.get("time"),
                            activity.get("title", ""),
                            activity.get("description"),
                            act_type,
                            activity.get("image_url"),
                            activity.get("latitude"),
                            activity.get("longitude"),
                        )
                    )

        _mark_vlog_complete(vlog_id)
        logger.info(f"TripKit {kit_id} generated for vlog {vlog_id}")
        return True

    except Exception as e:
        logger.error(f"DB write failed for vlog {vlog_id}: {e}", exc_info=True)
        _mark_vlog_failed(vlog_id)
        return False


def _mark_vlog_complete(vlog_id: str):
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "processingStatus" = 'COMPLETE', "processedAt" = NOW()
               WHERE id = %s''',
            (vlog_id,)
        )


def _mark_vlog_failed(vlog_id: str):
    with PgClient() as db:
        db.execute(
            'UPDATE "Vlog" SET "processingStatus" = \'FAILED\' WHERE id = %s',
            (vlog_id,)
        )


def extract_destinations(transcript: str, title: str) -> list[str]:
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
