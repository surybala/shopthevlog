import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { isE2EAuthEnabled } from '@/lib/e2eAuth'
import { buildTripKitSlug } from '@/lib/opportunityPublish'

const CREATOR_ID = 'e2e-creator-review-flow'
const VLOG_ID = 'e2e-vlog-review-flow'
const PRIMARY_OPPORTUNITY_ID = 'e2e-opp-review-flow-primary'
const SECONDARY_OPPORTUNITY_ID = 'e2e-opp-review-flow-secondary'
const PRIMARY_CANDIDATE_ID = 'e2e-candidate-review-flow-primary'
const SECONDARY_CANDIDATE_ID = 'e2e-candidate-review-flow-secondary'
const PRIMARY_TRANSCRIPT_EVIDENCE_ID = 'e2e-evidence-review-flow-transcript'
const PRIMARY_OCR_EVIDENCE_ID = 'e2e-evidence-review-flow-ocr'
const SECONDARY_EVIDENCE_ID = 'e2e-evidence-review-flow-secondary'
const HANDLE = 'qa-creator-e2e'
const PRIMARY_TRIP_KIT_SLUG = buildTripKitSlug('7 Days in Tokyo', CREATOR_ID)

function itineraryBlueprint(title: string, dayCount: number) {
  return {
    itinerary: {
      title,
      summary: 'A browser-seeded Tokyo itinerary for creator QA.',
      total_days: dayCount,
      destinations: ['Tokyo'],
      countries: ['Japan'],
      primary_city: 'Tokyo',
      estimated_budget_usd: 1800,
      days: Array.from({ length: dayCount }, (_unused, index) => ({
        day_number: index + 1,
        title: `Day ${index + 1}`,
        city: 'Tokyo',
        country: 'Japan',
        tips: index === 0 ? ['Use your Suica card on day one'] : [],
        activities: [
          {
            sort_order: 0,
            type: index === 0 ? 'ACCOMMODATION' : 'ATTRACTION',
            title: index === 0 ? 'Park Hyatt Tokyo' : 'Shibuya Sky',
            description: index === 0 ? 'Hotel stay featured in the vlog.' : 'Observation deck stop.',
          },
        ],
      })),
    },
    reviewRecommendation: 'strong_candidate',
    reviewRecommendationReason: 'This itinerary is ready for creator review in E2E tests.',
    isMultimodal: true,
    sourceTypes: ['TRANSCRIPT', 'OCR'],
  }
}

export async function POST(req: Request) {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' && body.userId.trim()
    ? body.userId.trim()
    : 'e2e-user-creator-review'

  await prisma.$transaction(async (tx) => {
    const existingOpportunities = await tx.opportunity.findMany({
      where: { vlogId: VLOG_ID },
      select: { id: true },
    })

    if (existingOpportunities.length > 0) {
      await tx.opportunityEvidence.deleteMany({
        where: {
          opportunityId: { in: existingOpportunities.map((opportunity) => opportunity.id) },
        },
      })
      await tx.opportunityFeedback.deleteMany({
        where: {
          opportunityId: { in: existingOpportunities.map((opportunity) => opportunity.id) },
        },
      })
    }

    const existingTripKits = await tx.tripKit.findMany({
      where: {
        creatorId: CREATOR_ID,
        slug: { in: [PRIMARY_TRIP_KIT_SLUG] },
      },
      select: { id: true },
    })
    const existingTripKitIds = existingTripKits.map((tripKit) => tripKit.id)

    if (existingTripKitIds.length > 0) {
      await tx.dayActivity.deleteMany({
        where: {
          day: {
            tripKitId: { in: existingTripKitIds },
          },
        },
      })
      await tx.itineraryDay.deleteMany({
        where: {
          tripKitId: { in: existingTripKitIds },
        },
      })
      await tx.tripKitsOnVlogs.deleteMany({
        where: {
          OR: [
            { vlogId: VLOG_ID },
            { tripKitId: { in: existingTripKitIds } },
          ],
        },
      })
      await tx.tripKit.deleteMany({
        where: {
          id: { in: existingTripKitIds },
        },
      })
    } else {
      await tx.tripKitsOnVlogs.deleteMany({
        where: {
          vlogId: VLOG_ID,
        },
      })
    }

    await tx.opportunity.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.resolvedEntity.deleteMany({
      where: {
        candidateEntity: {
          vlogId: VLOG_ID,
        },
      },
    })
    await tx.candidateEntity.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.evidence.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.frameAsset.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.sceneSegment.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.transcriptSegment.deleteMany({ where: { vlogId: VLOG_ID } })
    await tx.vlog.deleteMany({ where: { id: VLOG_ID } })
    await tx.creatorMemory.deleteMany({ where: { creatorId: CREATOR_ID } })

    await tx.creator.upsert({
      where: { id: CREATOR_ID },
      update: {
        userId,
        handle: HANDLE,
        displayName: 'QA Creator',
        bio: 'Creator account used for Playwright review and publish tests.',
        isPublished: true,
        isVerified: true,
      },
      create: {
        id: CREATOR_ID,
        userId,
        handle: HANDLE,
        displayName: 'QA Creator',
        bio: 'Creator account used for Playwright review and publish tests.',
        isPublished: true,
        isVerified: true,
      },
    })

    await tx.vlog.create({
      data: {
        id: VLOG_ID,
        creatorId: CREATOR_ID,
        platform: 'YOUTUBE',
        externalId: 'e2e-review-flow-video',
        externalUrl: 'https://youtube.com/watch?v=e2e-review-flow-video',
        title: 'Tokyo Creator Review Flow',
        description: 'Deterministic vlog for creator review and publish QA.',
        thumbnailUrl: 'https://picsum.photos/seed/e2e-review-flow/1280/720',
        processingStatus: 'REVIEW_PENDING',
        processedAt: new Date(),
        reviewReadyAt: new Date(),
        tags: ['e2e', 'review'],
        countries: ['Japan'],
        cities: ['Tokyo'],
      },
    })

    await tx.evidence.createMany({
      data: [
        {
          id: PRIMARY_TRANSCRIPT_EVIDENCE_ID,
          vlogId: VLOG_ID,
          sourceType: 'TRANSCRIPT',
          claimType: 'ITINERARY_STEP',
          startSec: 42,
          endSec: 88,
          confidence: 0.88,
          payloadJson: {
            title: 'Park Hyatt Tokyo',
            sourceType: 'TRANSCRIPT',
          },
        },
        {
          id: PRIMARY_OCR_EVIDENCE_ID,
          vlogId: VLOG_ID,
          sourceType: 'OCR',
          claimType: 'STAYED_AT',
          startSec: 51,
          endSec: 77,
          confidence: 0.81,
          payloadJson: {
            title: 'Park Hyatt Tokyo sign',
            sourceType: 'VISUAL',
          },
        },
        {
          id: SECONDARY_EVIDENCE_ID,
          vlogId: VLOG_ID,
          sourceType: 'TRANSCRIPT',
          claimType: 'ITINERARY_STEP',
          startSec: 110,
          endSec: 130,
          confidence: 0.62,
          payloadJson: {
            title: 'Older Tokyo plan',
            sourceType: 'TRANSCRIPT',
          },
        },
      ],
    })

    await tx.candidateEntity.createMany({
      data: [
        {
          id: PRIMARY_CANDIDATE_ID,
          vlogId: VLOG_ID,
          entityType: 'PLACE',
          subtype: 'hotel',
          canonicalLabel: 'Park Hyatt Tokyo',
          rawLabel: 'Park Hyatt',
          startSec: 42,
          endSec: 88,
          confidence: 0.9,
          status: 'RESOLVED',
          evidenceBundleJson: {
            evidenceIds: [PRIMARY_TRANSCRIPT_EVIDENCE_ID, PRIMARY_OCR_EVIDENCE_ID],
            sourceTypes: ['TRANSCRIPT', 'OCR'],
            isMultimodal: true,
          },
        },
        {
          id: SECONDARY_CANDIDATE_ID,
          vlogId: VLOG_ID,
          entityType: 'PLACE',
          subtype: 'hotel',
          canonicalLabel: 'Tokyo Alternate Plan',
          rawLabel: 'Tokyo Alternate Plan',
          startSec: 110,
          endSec: 130,
          confidence: 0.63,
          status: 'NEW',
          evidenceBundleJson: {
            evidenceIds: [SECONDARY_EVIDENCE_ID],
            sourceTypes: ['TRANSCRIPT'],
          },
        },
      ],
    })

    await tx.opportunity.createMany({
      data: [
        {
          id: PRIMARY_OPPORTUNITY_ID,
          vlogId: VLOG_ID,
          creatorId: CREATOR_ID,
          opportunityType: 'ITINERARY',
          candidateEntityId: PRIMARY_CANDIDATE_ID,
          title: '7 Days in Tokyo',
          description: 'Primary itinerary selected for creator publish QA.',
          rankScore: 0.93,
          confidence: 0.9,
          publishState: 'DRAFT',
          reviewState: 'EDITED',
          metadataJson: itineraryBlueprint('7 Days in Tokyo', 2),
        },
        {
          id: SECONDARY_OPPORTUNITY_ID,
          vlogId: VLOG_ID,
          creatorId: CREATOR_ID,
          opportunityType: 'ITINERARY',
          candidateEntityId: SECONDARY_CANDIDATE_ID,
          title: 'Older Tokyo Cut',
          description: 'Secondary itinerary that should be suppressed when publishing the primary one.',
          rankScore: 0.61,
          confidence: 0.63,
          publishState: 'DRAFT',
          reviewState: 'APPROVED',
          metadataJson: {
            ...itineraryBlueprint('Older Tokyo Cut', 1),
            isMultimodal: false,
            sourceTypes: ['TRANSCRIPT'],
            reviewRecommendation: 'standard_review',
            reviewRecommendationReason: 'Older itinerary variant retained for publish suppression QA.',
          },
        },
      ],
    })

    await tx.opportunityEvidence.createMany({
      data: [
        {
          opportunityId: PRIMARY_OPPORTUNITY_ID,
          evidenceId: PRIMARY_TRANSCRIPT_EVIDENCE_ID,
        },
        {
          opportunityId: PRIMARY_OPPORTUNITY_ID,
          evidenceId: PRIMARY_OCR_EVIDENCE_ID,
        },
        {
          opportunityId: SECONDARY_OPPORTUNITY_ID,
          evidenceId: SECONDARY_EVIDENCE_ID,
        },
      ],
    })

    await tx.creatorMemory.create({
      data: {
        creatorId: CREATOR_ID,
        memoryType: 'NAMING_PREFERENCE',
        key: 'park hyatt tokyo',
        valueJson: {
          preferredTitle: 'Park Hyatt Tokyo',
        },
      },
    })
  })

  return NextResponse.json({
    ok: true,
    creatorId: CREATOR_ID,
    creatorHandle: HANDLE,
    userId,
    vlogId: VLOG_ID,
    primaryOpportunityId: PRIMARY_OPPORTUNITY_ID,
    reviewUrl: `/dashboard/review/${VLOG_ID}`,
    storefrontUrl: `/@${HANDLE}`,
  })
}
