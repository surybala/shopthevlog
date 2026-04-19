"""
Gemini Flash Lite integration for Trip Kit generation from vlog transcripts.
Writes to TripKit / ItineraryDay / DayActivity / TripKitsOnVlogs tables.
"""
import hashlib
import json
import logging
import re
from typing import Optional

from google import genai
from google.genai import types

from app.core.config import settings
from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

# Lazy-initialised client — only created when first needed so a missing key
# doesn't crash startup.
_gemini_client: Optional[genai.Client] = None


def _client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        if not settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _gemini_client


GEMINI_MODEL = "gemini-2.5-flash"

# ─── Prompts ──────────────────────────────────────────────────────────────────

ITINERARY_SYSTEM_PROMPT = """You are an expert at extracting shoppable travel itineraries from vlog transcripts.

━━━ STEP 1: SHOPPABILITY CHECK ━━━

Respond with {"skip": true} if ANY of the following are true:
• The content is not travel-related (sports, gaming, cooking at home, fitness, juggling, music, product reviews, etc.)
• The transcript is travel-related but mentions no SPECIFIC NAMED places (e.g. only says "we visited a nice restaurant" or "we went to a museum" without naming them)
• You cannot fill at least ONE full day with named, bookable places actually mentioned in the transcript without inventing anything

A shoppable place is a NAMED, REAL, BOOKABLE item: a specific hotel, restaurant, tour, attraction, or experience a viewer could actually search for and book.

If in doubt, respond with {"skip": true}. It is better to skip than to hallucinate.

━━━ STEP 2: EXTRACT THE ITINERARY ━━━

Your entire response must be a single valid JSON object. No markdown, no backticks. Start with { end with }.

STRICT RULES — violations make the output worthless:
• ONLY include places, activities, and experiences EXPLICITLY mentioned in the transcript.
• NEVER invent, guess, or fill gaps with plausible-sounding places.
• If a day has fewer than 2 named bookable activities, omit that day entirely.
• Do not pad with generic filler ("Free time", "Explore the city", "Rest", etc.)
• Max 10 days. No minimum — include only the days you have real content for.

JSON schema:
{
  "title": "string (accurate title reflecting the actual trip)",
  "summary": "string (2-3 sentences, only facts from the transcript)",
  "total_days": integer,
  "destinations": ["only cities/regions explicitly visited"],
  "countries": ["only countries explicitly visited"],
  "primary_city": "string",
  "estimated_budget_usd": integer | null,
  "days": [
    {
      "day_number": integer,
      "city": "string (must be mentioned in transcript)",
      "country": "string",
      "title": "string",
      "summary": "string (only facts from transcript)",
      "activities": [
        {
          "sort_order": integer,
          "type": "ACCOMMODATION|FOOD|TOUR|ADVENTURE|CULTURAL|WELLNESS|NIGHTLIFE|TRANSPORT|ATTRACTION|OTHER",
          "title": "string (the actual named place or experience)",
          "description": "string (max 30 words, only what the vlogger said about it)",
          "time": "HH:MM or null",
          "latitude": number | null,
          "longitude": number | null,
          "image_url": null
        }
      ]
    }
  ]
}

YOUR ENTIRE RESPONSE IS THE JSON OBJECT."""

ITINERARY_COMPACT_PROMPT = """Shoppable travel itinerary extractor. ONE valid JSON object only, no markdown.

Respond with {"skip": true} if:
- Not travel content, OR
- No specific named bookable places (hotels/restaurants/attractions/tours) in the transcript, OR
- You would need to invent anything to fill even one day

NEVER invent places. Only extract what is explicitly named in the transcript.

Schema (only if genuinely shoppable travel content exists):
{"title":"string","summary":"string","total_days":integer,"destinations":["string"],"countries":["string"],"primary_city":"string","estimated_budget_usd":null,"days":[{"day_number":integer,"city":"string","country":"string","title":"string","summary":"string","activities":[{"sort_order":integer,"type":"ATTRACTION","title":"string (named place only)","description":"string (max 20 words, transcript facts only)","time":null,"latitude":null,"longitude":null,"image_url":null}]}]}

No filler activities. No invented places. JSON ONLY."""

DESTINATION_EXTRACTION_PROMPT = """Extract all travel destination names from this text. Return ONLY a JSON array of strings. Example: ["Tokyo", "Japan", "Kyoto"]. No explanation."""

TRANSCRIPT_OPPORTUNITY_SYSTEM_PROMPT = """You convert travel vlog transcripts into evidence-backed structured opportunities.

Return ONE valid JSON object only. No markdown, no prose.

Schema:
{
  "opportunities": [
    {
      "claim_type": "itinerary_step|stayed_at|visited|ate_at|drank_at|packed|used|recommends|purchased",
      "entity_type": "experience|place|product|brand",
      "subtype": "hotel|restaurant|cafe|attraction|activity|travel_product|packing_item|itinerary_step",
      "title": "short human title",
      "raw_label": "raw extracted label",
      "description": "short factual description",
      "confidence": 0.0,
      "start_sec": 0,
      "end_sec": 30,
      "evidence_summary": "brief evidence summary",
      "attributes": {}
    }
  ]
}

Rules:
- Only extract opportunities explicitly supported by the transcript.
- Prefer travel-relevant opportunities.
- Include itinerary steps when the transcript clearly describes the sequence of the trip.
- Use confidence between 0 and 1.
- If the transcript has no clear opportunities, return {"opportunities":[]}.
"""

TRANSCRIPT_GRAPH_SYSTEM_PROMPT = """You convert a travel vlog transcript into both:
1. an itinerary blueprint for storefront publishing
2. evidence-backed structured opportunities for the review graph

Return ONE valid JSON object only. No markdown, no prose.

Schema:
{
  "skip": false,
  "itinerary": {
    "title": "string",
    "summary": "string",
    "total_days": 1,
    "destinations": ["string"],
    "countries": ["string"],
    "primary_city": "string",
    "estimated_budget_usd": null,
    "days": [
      {
        "day_number": 1,
        "city": "string",
        "country": "string",
        "title": "string",
        "summary": "string",
        "activities": [
          {
            "sort_order": 0,
            "type": "ACCOMMODATION|FOOD|TOUR|ADVENTURE|CULTURAL|WELLNESS|NIGHTLIFE|TRANSPORT|ATTRACTION|OTHER",
            "title": "string",
            "description": "string",
            "time": "HH:MM or null",
            "latitude": null,
            "longitude": null,
            "image_url": null
          }
        ]
      }
    ]
  },
  "opportunities": [
    {
      "claim_type": "itinerary_step|stayed_at|visited|ate_at|drank_at|packed|used|recommends|purchased",
      "entity_type": "experience|place|product|brand",
      "subtype": "hotel|restaurant|cafe|attraction|activity|travel_product|packing_item|itinerary_step",
      "title": "short human title",
      "raw_label": "raw extracted label",
      "description": "short factual description",
      "confidence": 0.0,
      "start_sec": 0,
      "end_sec": 30,
      "evidence_summary": "brief evidence summary",
      "attributes": {}
    }
  ]
}

Rules:
- If the vlog is not shoppable travel content, return {"skip": true, "itinerary": null, "opportunities": []}.
- Only extract places, products, and experiences explicitly supported by the transcript.
- Never invent places or filler activities.
- Prefer travel-relevant named opportunities.
- Include itinerary steps when the transcript clearly describes the sequence of the trip.
- Confidence must be between 0 and 1.
"""

VISUAL_OPPORTUNITY_SYSTEM_PROMPT = """You analyze a single travel vlog frame and return only high-signal travel-shopping evidence.

Return ONE valid JSON object only. No markdown, no prose.

Schema:
{
  "signals": [
    {
      "source_type": "ocr|object_detection|logo_detection|clip_summary",
      "entity_type": "place|product|experience|brand",
      "subtype": "hotel|restaurant|cafe|attraction|activity|travel_product|packing_item|brand|scene_summary",
      "title": "short label",
      "raw_label": "raw extracted text or object name",
      "description": "short factual description",
      "confidence": 0.0,
      "claim_type": "visited|used|packed|recommends|itinerary_step|null",
      "evidence_summary": "brief explanation of what is visible",
      "attributes": {}
    }
  ]
}

Rules:
- Extract only what is actually visible in the frame.
- Prefer named travel-relevant places, products, logos, and signs.
- OCR should only include readable text that matters to a traveler.
- object_detection should focus on luggage, gear, hotel room, restaurant table, landmark-like scenes, or transit.
- logo_detection should only include logos/brands that are clearly visible.
- clip_summary may summarize the scene only when it gives useful travel context.
- If the frame contains no useful travel-shopping signal, return {"signals":[]}.
"""

VISUAL_BATCH_OPPORTUNITY_SYSTEM_PROMPT = """You analyze a small batch of travel vlog frames and return only high-signal travel-shopping evidence.

Return ONE valid JSON object only. No markdown, no prose.

Schema:
{
  "frames": [
    {
      "frame_id": "string",
      "signals": [
        {
          "source_type": "ocr|object_detection|logo_detection|clip_summary",
          "entity_type": "place|product|experience|brand",
          "subtype": "hotel|restaurant|cafe|attraction|activity|travel_product|packing_item|brand|scene_summary",
          "title": "short label",
          "raw_label": "raw extracted text or object name",
          "description": "short factual description",
          "confidence": 0.0,
          "claim_type": "visited|used|packed|recommends|itinerary_step|null",
          "evidence_summary": "brief explanation of what is visible",
          "attributes": {}
        }
      ]
    }
  ]
}

Rules:
- Only extract what is actually visible in each frame.
- Keep signals grouped under the correct frame_id.
- Prefer named travel-relevant places, products, logos, and signs.
- OCR should only include readable text that matters to a traveler.
- object_detection should focus on luggage, gear, hotel room, restaurant table, landmark-like scenes, or transit.
- logo_detection should only include logos/brands that are clearly visible.
- clip_summary may summarize the scene only when it gives useful travel context.
- If a frame contains no useful travel-shopping signal, return that frame with "signals": [].
"""


# ─── Helpers ──────────────────────────────────────────────────────────────────

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


def _call_gemini(system: str, user_content: str, max_tokens: int) -> str:
    """Call Gemini and return the raw text response."""
    response = _client().models.generate_content(
        model=GEMINI_MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=0.4,
            response_mime_type="application/json",
        ),
    )
    return response.text or ""


def _call_gemini_parts(system: str, contents: list[types.Part], max_tokens: int, temperature: float = 0.2) -> str:
    response = _client().models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=temperature,
            response_mime_type="application/json",
        ),
    )
    return response.text or ""


def _parse_response(raw_text: str, vlog_id: str, attempt: str) -> Optional[dict]:
    if not raw_text:
        logger.warning(f"Gemini returned empty response [{attempt}] for vlog {vlog_id}")
        return None
    cleaned = _strip_code_fences(raw_text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(
            f"Gemini invalid JSON [{attempt}] for vlog {vlog_id}: {e}. "
            f"Raw: {raw_text[:400]}"
        )
        return None


# ─── Public API ───────────────────────────────────────────────────────────────

def generate_trip_kit(vlog_id: str, transcript: str, title: str, creator_id: str) -> bool:
    """
    Generate and persist a TripKit for a vlog using Gemini Flash Lite.
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

    user_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:30000]}"
    itinerary_data: Optional[dict] = None

    # Attempt 1: full prompt
    try:
        raw = _call_gemini(ITINERARY_SYSTEM_PROMPT, user_content, max_tokens=16000)
        itinerary_data = _parse_response(raw, vlog_id, "primary")
    except Exception as e:
        logger.error(f"Gemini API error (primary) for vlog {vlog_id}: {e}")

    # Attempt 2: compact fallback with shorter transcript
    if itinerary_data is None:
        logger.info(f"Retrying with compact prompt for vlog {vlog_id}")
        try:
            compact_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:8000]}"
            raw2 = _call_gemini(ITINERARY_COMPACT_PROMPT, compact_content, max_tokens=4096)
            itinerary_data = _parse_response(raw2, vlog_id, "compact")
        except Exception as e:
            logger.error(f"Gemini API error (compact) for vlog {vlog_id}: {e}")

    if itinerary_data is None:
        _mark_vlog_failed(vlog_id)
        return False

    # Not shoppable / not travel — model explicitly said to skip.
    if itinerary_data.get("skip") or itinerary_data.get("not_travel"):
        logger.info(f"Vlog {vlog_id} skipped — not shoppable travel content")
        _mark_vlog_not_travel(vlog_id)
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
                    "isPublished", "isFeatured", "generatedByAI",
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


def _mark_vlog_not_travel(vlog_id: str):
    """Mark a vlog as COMPLETE but with no kit — it simply isn't travel content."""
    with PgClient() as db:
        db.execute(
            '''UPDATE "Vlog"
               SET "processingStatus" = 'COMPLETE', "processedAt" = NOW()
               WHERE id = %s''',
            (vlog_id,)
        )


def extract_destinations(transcript: str, title: str) -> list[str]:
    try:
        text = f"Title: {title}\n\n{transcript[:4000]}"
        raw = _call_gemini(
            DESTINATION_EXTRACTION_PROMPT,
            f"Text: {text}",
            max_tokens=256,
        )
        return json.loads(raw.strip())
    except Exception as e:
        logger.warning(f"extract_destinations failed: {e}")
        return []


def extract_transcript_opportunities(transcript: str, title: str) -> list[dict]:
    """Extract structured opportunity candidates from a transcript."""
    try:
        raw = _call_gemini(
            TRANSCRIPT_OPPORTUNITY_SYSTEM_PROMPT,
            f"Vlog title: {title}\n\nTranscript:\n{transcript[:20000]}",
            max_tokens=4096,
        )
        parsed = _parse_response(raw, title, "transcript-opportunities")
        if not parsed:
            return []
        opportunities = parsed.get("opportunities")
        if not isinstance(opportunities, list):
            return []
        return [item for item in opportunities if isinstance(item, dict)]
    except Exception as e:
        logger.warning("extract_transcript_opportunities failed: %s", e)
        return []


def extract_transcript_graph_payload(transcript: str, title: str) -> dict:
    """
    Extract itinerary blueprint and transcript opportunities in one Gemini call.

    Falls back to the legacy split calls if the combined response fails so the
    graph pipeline preserves accuracy while reducing token use on the happy path.
    """
    try:
        raw = _call_gemini(
            TRANSCRIPT_GRAPH_SYSTEM_PROMPT,
            f"Vlog title: {title}\n\nTranscript:\n{transcript[:20000]}",
            max_tokens=8192,
        )
        parsed = _parse_response(raw, title, "transcript-graph")
        if isinstance(parsed, dict):
            itinerary = parsed.get("itinerary")
            if itinerary is not None and not isinstance(itinerary, dict):
                itinerary = None
            opportunities = parsed.get("opportunities")
            if not isinstance(opportunities, list):
                opportunities = []
            return {
                "skip": bool(parsed.get("skip") or parsed.get("not_travel")),
                "itinerary": itinerary,
                "opportunities": [item for item in opportunities if isinstance(item, dict)],
            }
    except Exception as e:
        logger.warning("extract_transcript_graph_payload failed: %s", e)

    itinerary = extract_itinerary_blueprint(transcript, title)
    opportunities = extract_transcript_opportunities(transcript, title)
    return {
        "skip": bool((itinerary or {}).get("skip") or (itinerary or {}).get("not_travel")),
        "itinerary": itinerary if isinstance(itinerary, dict) and not itinerary.get("skip") and not itinerary.get("not_travel") else None,
        "opportunities": opportunities,
    }


def extract_visual_opportunities(
    frame_image_bytes: bytes,
    title: str,
    scene_summary: str | None = None,
    content_type: str = "image/jpeg",
) -> list[dict]:
    """Extract structured visual evidence from a stored frame payload."""
    return _extract_visual_frame_signals(
        {
            "frame_id": "frame-0",
            "image_bytes": frame_image_bytes,
            "content_type": content_type,
            "scene_summary": scene_summary,
        },
        title,
    )


def _extract_visual_frame_signals(frame: dict, title: str) -> list[dict]:
    try:
        content_type = str(frame.get("content_type") or "image/jpeg").split(";")[0].strip() or "image/jpeg"
        contents = [
            types.Part.from_bytes(data=frame["image_bytes"], mime_type=content_type),
            types.Part.from_text(
                text="\n".join(
                    [
                        f"Vlog title: {title}",
                        f'frame_id="{frame["frame_id"]}"',
                        f'scene_summary="{frame.get("scene_summary") or "Unknown"}"',
                    ]
                )
            ),
        ]
        raw = _call_gemini_parts(
            VISUAL_OPPORTUNITY_SYSTEM_PROMPT,
            contents,
            max_tokens=2048,
            temperature=0.15,
        )
        parsed = _parse_response(raw, title, "visual-opportunities-single")
        if not parsed:
            return []
        signals = parsed.get("signals")
        if not isinstance(signals, list):
          payload_frames = parsed.get("frames")
          if isinstance(payload_frames, list) and payload_frames:
              first_frame = payload_frames[0] if isinstance(payload_frames[0], dict) else {}
              signals = first_frame.get("signals")
        if not isinstance(signals, list):
            return []
        return [item for item in signals if isinstance(item, dict)]
    except Exception as e:
        logger.warning("extract_visual_frame_signals failed: %s", e)
        return []


def extract_visual_opportunities_batch(frames: list[dict], title: str) -> dict[str, list[dict]]:
    """Extract structured visual evidence from a small batch of frame payloads."""
    valid_frames = [
        frame for frame in frames
        if isinstance(frame, dict) and frame.get("frame_id") and frame.get("image_bytes")
    ]
    if not valid_frames:
        return {}

    try:
        prompt_lines = [f"Vlog title: {title}", "Frame context:"]
        contents: list[types.Part] = []
        for frame in valid_frames:
            content_type = str(frame.get("content_type") or "image/jpeg").split(";")[0].strip() or "image/jpeg"
            contents.append(types.Part.from_bytes(data=frame["image_bytes"], mime_type=content_type))
            prompt_lines.append(
                f'- frame_id="{frame["frame_id"]}"; scene_summary="{frame.get("scene_summary") or "Unknown"}"'
            )

        contents.append(types.Part.from_text(text="\n".join(prompt_lines)))
        raw = _call_gemini_parts(
            VISUAL_BATCH_OPPORTUNITY_SYSTEM_PROMPT,
            contents,
            max_tokens=4096,
            temperature=0.15,
        )
        parsed = _parse_response(raw, title, "visual-opportunities-batch")
        if not parsed:
            logger.warning(
                "Falling back to per-frame visual extraction after invalid batch response for vlog %s",
                title,
            )
            return {
                frame["frame_id"]: _extract_visual_frame_signals(frame, title)
                for frame in valid_frames
            }

        payload_frames = parsed.get("frames")
        if not isinstance(payload_frames, list):
            logger.warning(
                "Falling back to per-frame visual extraction after malformed batch payload for vlog %s",
                title,
            )
            return {
                frame["frame_id"]: _extract_visual_frame_signals(frame, title)
                for frame in valid_frames
            }

        signals_by_frame: dict[str, list[dict]] = {frame["frame_id"]: [] for frame in valid_frames}
        for payload_frame in payload_frames:
            if not isinstance(payload_frame, dict):
                continue
            frame_id = payload_frame.get("frame_id")
            if frame_id not in signals_by_frame:
                continue
            signals = payload_frame.get("signals")
            if not isinstance(signals, list):
                continue
            signals_by_frame[frame_id] = [item for item in signals if isinstance(item, dict)]
        return signals_by_frame
    except Exception as e:
        logger.warning("extract_visual_opportunities_batch failed: %s", e)
        return {
            frame["frame_id"]: _extract_visual_frame_signals(frame, title)
            for frame in valid_frames
        }


def extract_itinerary_blueprint(transcript: str, title: str) -> Optional[dict]:
    """
    Return a structured itinerary blueprint without writing any DB rows.

    This is the graph-era replacement for letting the model write TripKit tables
    directly. The publish layer can project this blueprint into storefront data.
    """
    user_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:30000]}"
    itinerary_data: Optional[dict] = None

    try:
        raw = _call_gemini(ITINERARY_SYSTEM_PROMPT, user_content, max_tokens=16000)
        itinerary_data = _parse_response(raw, title, "itinerary-blueprint-primary")
    except Exception as e:
        logger.error("Gemini itinerary blueprint error (primary): %s", e)

    if itinerary_data is None:
        try:
            compact_content = f"Vlog title: {title}\n\nTranscript:\n{transcript[:8000]}"
            raw = _call_gemini(ITINERARY_COMPACT_PROMPT, compact_content, max_tokens=4096)
            itinerary_data = _parse_response(raw, title, "itinerary-blueprint-compact")
        except Exception as e:
            logger.error("Gemini itinerary blueprint error (compact): %s", e)

    return itinerary_data
