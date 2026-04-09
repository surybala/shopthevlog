import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  buildTripKitPublishSummary,
  getItineraryBlueprint,
  normalizeActivityType,
  selectPublishableItineraryOpportunity,
} from '@/lib/opportunityPublish'

async function getOwnedVlogForPublish(vlogId: string, userId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null

  const vlog = await prisma.vlog.findFirst({
    where: {
      id: vlogId,
      creatorId: creator.id,
    },
    select: {
      id: true,
      creatorId: true,
      opportunities: {
        select: {
          id: true,
          title: true,
          description: true,
          reviewState: true,
          publishState: true,
          metadataJson: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      tripKits: {
        select: {
          tripKit: {
            select: {
              id: true,
              title: true,
              slug: true,
              isPublished: true,
            },
          },
        },
        take: 1,
      },
    },
  })

  if (!vlog) return null
  return { creator, vlog }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedVlogForPublish(params.id, user.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existingTripKit = owned.vlog.tripKits[0]?.tripKit ?? null
  const summary = buildTripKitPublishSummary({
    creatorId: owned.creator.id,
    opportunities: owned.vlog.opportunities,
    existingTripKit,
  })
  if (!summary.readyToPublish) {
    return NextResponse.json({ error: 'No approved itinerary opportunity is ready to publish' }, { status: 409 })
  }

  const sourceOpportunity = selectPublishableItineraryOpportunity(owned.vlog.opportunities)
  const itinerary = sourceOpportunity ? getItineraryBlueprint(sourceOpportunity) : null
  if (!sourceOpportunity || !itinerary) {
    return NextResponse.json({ error: 'Publishable itinerary blueprint is missing' }, { status: 409 })
  }

  const result = await prisma.$transaction(async (tx) => {
    let tripKitId = existingTripKit?.id ?? null

    if (tripKitId) {
      await tx.tripKit.update({
        where: { id: tripKitId },
        data: {
          title: summary.itinerary!.title,
          slug: summary.itinerary!.slug,
          description: summary.itinerary!.summary,
          countries: summary.itinerary!.countries,
          cities: summary.itinerary!.destinations,
          primaryCity: summary.itinerary!.primaryCity,
          durationDays: itinerary.total_days ?? summary.totalDays ?? null,
          estimatedBudgetLow: summary.itinerary!.estimatedBudgetUsd,
          estimatedBudgetHigh: summary.itinerary!.estimatedBudgetUsd,
          generatedByAI: true,
          isPublished: true,
        },
      })

      await tx.dayActivity.deleteMany({
        where: {
          day: {
            tripKitId,
          },
        },
      })
      await tx.itineraryDay.deleteMany({
        where: {
          tripKitId,
        },
      })
    } else {
      const createdTripKit = await tx.tripKit.create({
        data: {
          creatorId: owned.creator.id,
          title: summary.itinerary!.title,
          slug: summary.itinerary!.slug,
          description: summary.itinerary!.summary,
          countries: summary.itinerary!.countries,
          cities: summary.itinerary!.destinations,
          primaryCity: summary.itinerary!.primaryCity,
          durationDays: itinerary.total_days ?? summary.totalDays ?? null,
          estimatedBudgetLow: summary.itinerary!.estimatedBudgetUsd,
          estimatedBudgetHigh: summary.itinerary!.estimatedBudgetUsd,
          generatedByAI: true,
          isPublished: true,
          isFeatured: false,
        },
        select: {
          id: true,
          title: true,
          slug: true,
        },
      })
      tripKitId = createdTripKit.id

      await tx.tripKitsOnVlogs.create({
        data: {
          tripKitId,
          vlogId: owned.vlog.id,
        },
      })
    }

    for (const [index, day] of (itinerary.days ?? []).entries()) {
      await tx.itineraryDay.create({
        data: {
          tripKitId,
          dayNumber: day.day_number ?? index + 1,
          title: day.title ?? `Day ${day.day_number ?? index + 1}`,
          summary: day.summary ?? null,
          city: day.city ?? null,
          country: day.country ?? null,
          tips: day.tips ?? [],
          activities: {
            create: (day.activities ?? []).map((activity, activityIndex) => ({
              sortOrder: activity.sort_order ?? activityIndex,
              time: activity.time ?? null,
              title: activity.title ?? '',
              description: activity.description ?? null,
              type: normalizeActivityType(activity.type) as never,
              imageUrl: activity.image_url ?? null,
              latitude: activity.latitude ?? null,
              longitude: activity.longitude ?? null,
            })),
          },
        },
      })
    }

    await tx.opportunity.update({
      where: { id: sourceOpportunity.id },
      data: {
        publishState: 'PUBLISHED',
      },
    })

    await tx.vlog.update({
      where: { id: owned.vlog.id },
      data: {
        processingStatus: 'PUBLISHED',
        processedAt: new Date(),
        publishedFromGraphAt: new Date(),
        lastPipelineRunAt: new Date(),
      },
    })

    const tripKit = await tx.tripKit.findUnique({
      where: { id: tripKitId },
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true,
      },
    })

    return {
      tripKit,
      opportunityId: sourceOpportunity.id,
    }
  })

  return NextResponse.json({
    ok: true,
    action: existingTripKit ? 'republished' : 'published',
    sourceOpportunityId: result.opportunityId,
    tripKit: result.tripKit,
  })
}
