"""
Graph-backed storefront publishing.

Manual graph-backed storefront publishing.

When this service is invoked, it should behave like the explicit creator
publish action and produce a live published TripKit projection.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)


def _slugify(title: str, creator_id: str) -> str:
    base = "".join(ch.lower() if ch.isalnum() else "-" for ch in title).strip("-")
    while "--" in base:
        base = base.replace("--", "-")
    base = base[:50].strip("-") or "trip-kit"
    suffix = hashlib.md5(f"{creator_id}{title}".encode()).hexdigest()[:6]
    return f"{base}-{suffix}"


def publish_tripkit_from_graph(vlog_id: str) -> bool:
    with PgClient() as db:
        db.execute(
            '''SELECT v.id, v.title, v."creatorId", opp.id AS "opportunityId",
                      opp.title AS "opportunityTitle", opp.description AS "opportunityDescription",
                      opp."metadataJson"
               FROM "Vlog" v
               JOIN "Opportunity" opp ON opp."vlogId" = v.id
               WHERE v.id = %s
                 AND opp."opportunityType" = 'ITINERARY'
                 AND opp."reviewState" IN ('APPROVED', 'AUTO_APPROVED', 'EDITED')
                 AND opp."publishState" != 'SUPPRESSED'
               ORDER BY opp."createdAt" DESC
               LIMIT 1''',
            (vlog_id,),
        )
        row = db.fetchone()

    if not row:
        logger.info("No publishable itinerary opportunity found for vlog %s", vlog_id)
        return False

    metadata = row["metadataJson"] or {}
    itinerary = metadata.get("itinerary") if isinstance(metadata, dict) else None
    if not itinerary:
        logger.warning("Itinerary opportunity %s had no itinerary blueprint", row["opportunityId"])
        return False

    creator_id = row["creatorId"]
    title = itinerary.get("title") or row["opportunityTitle"] or row["title"]
    slug = _slugify(title, creator_id)
    countries = itinerary.get("countries") or itinerary.get("destinations") or []
    cities = itinerary.get("destinations") or []
    primary_city = itinerary.get("primary_city") or (cities[0] if cities else None)
    budget = itinerary.get("estimated_budget_usd")
    days: list[dict[str, Any]] = itinerary.get("days") or []

    with PgClient() as db:
        db.execute(
            'SELECT "tripKitId" FROM "TripKitsOnVlogs" WHERE "vlogId" = %s LIMIT 1',
            (vlog_id,),
        )
        existing_link = db.fetchone()

        if existing_link:
            tripkit_id = existing_link["tripKitId"]
            db.execute(
                '''UPDATE "TripKit"
                   SET title = %s,
                       slug = %s,
                       description = %s,
                       countries = %s,
                       cities = %s,
                       "primaryCity" = %s,
                       "durationDays" = %s,
                       "estimatedBudgetLow" = %s,
                       "estimatedBudgetHigh" = %s,
                       "generatedByAI" = true,
                       "isPublished" = true,
                       "updatedAt" = NOW()
                   WHERE id = %s''',
                (
                    title,
                    slug,
                    row["opportunityDescription"],
                    countries,
                    cities,
                    primary_city,
                    itinerary.get("total_days"),
                    budget,
                    budget,
                    tripkit_id,
                ),
            )
            db.execute(
                '''DELETE FROM "DayActivity"
                   WHERE "dayId" IN (SELECT id FROM "ItineraryDay" WHERE "tripKitId" = %s)''',
                (tripkit_id,),
            )
            db.execute('DELETE FROM "ItineraryDay" WHERE "tripKitId" = %s', (tripkit_id,))
        else:
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
                    true, false, true,
                    0, 0, 0, 0, 0, 0,
                    NOW(), NOW()
                ) RETURNING id''',
                (
                    creator_id,
                    title,
                    slug,
                    row["opportunityDescription"],
                    countries,
                    cities,
                    primary_city,
                    itinerary.get("total_days"),
                    budget,
                    budget,
                ),
            )
            tripkit_id = db.fetchone()["id"]
            db.execute(
                'INSERT INTO "TripKitsOnVlogs" ("tripKitId", "vlogId") VALUES (%s, %s)',
                (tripkit_id, vlog_id),
            )

        for day in days:
            db.execute(
                '''INSERT INTO "ItineraryDay" (
                    id, "tripKitId", "dayNumber", title, summary, city, country, tips
                ) VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id''',
                (
                    tripkit_id,
                    day.get("day_number", 1),
                    day.get("title", f"Day {day.get('day_number', 1)}"),
                    day.get("summary"),
                    day.get("city"),
                    day.get("country"),
                    day.get("tips") or [],
                ),
            )
            day_id = db.fetchone()["id"]

            for activity in day.get("activities", []):
                act_type = activity.get("type", "OTHER")
                valid_types = {
                    "ACCOMMODATION", "FOOD", "TOUR", "ADVENTURE",
                    "CULTURAL", "WELLNESS", "NIGHTLIFE", "TRANSPORT",
                    "ATTRACTION", "OTHER",
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
                    ),
                )

        db.execute(
            '''UPDATE "Opportunity"
               SET "publishState" = 'PUBLISHED', "updatedAt" = NOW()
               WHERE id = %s''',
            (row["opportunityId"],),
        )
        db.execute(
            '''UPDATE "Vlog"
               SET "processingStatus" = 'PUBLISHED',
                   "processedAt" = NOW(),
                   "publishedFromGraphAt" = NOW(),
                   "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    logger.info("Published TripKit projection for vlog %s from graph", vlog_id)
    return True
