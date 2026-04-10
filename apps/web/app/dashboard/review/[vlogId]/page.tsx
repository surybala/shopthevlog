import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { buildCreatorMemoryHints, normalizeCreatorMemoryKey } from '@/lib/creatorMemory'
import { buildTripKitPublishSummary } from '@/lib/opportunityPublish'
import {
  formatReviewRecommendationLabel,
  formatOpportunityTypeLabel,
  getMultimodalEvidenceLabel,
  getReviewRecommendation,
  getReviewRecommendationReason,
  rankReviewQueue,
  reviewRecommendationTone,
  summarizeEvidenceSources,
} from '@/lib/opportunityReview'
import PublishTripKitButton from '../PublishTripKitButton'
import ReviewDecisionButtons from '../ReviewDecisionButtons'
import ReviewEditForm from '../ReviewEditForm'

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export default async function DashboardReviewVideoPage({ params }: { params: { vlogId: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const vlog = await prisma.vlog.findFirst({
    where: {
      id: params.vlogId,
      creatorId: creator.id,
    },
    select: {
      id: true,
      title: true,
      externalUrl: true,
      thumbnailUrl: true,
      processingStatus: true,
      tripKits: {
        select: {
          tripKit: {
            select: {
              id: true,
              title: true,
              slug: true,
              isPublished: true,
              primaryCity: true,
              durationDays: true,
              days: {
                select: {
                  id: true,
                  activities: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
        take: 1,
      },
      opportunities: {
        where: {
          publishState: { not: 'SUPPRESSED' },
        },
        select: {
          id: true,
          title: true,
          description: true,
          opportunityType: true,
          reviewState: true,
          publishState: true,
          confidence: true,
          rankScore: true,
          metadataJson: true,
          createdAt: true,
          updatedAt: true,
          candidateEntity: {
            select: {
              canonicalLabel: true,
              rawLabel: true,
              entityType: true,
              subtype: true,
              startSec: true,
              endSec: true,
            },
          },
          evidences: {
            include: {
              evidence: {
                select: {
                  sourceType: true,
                  startSec: true,
                  endSec: true,
                },
              },
            },
          },
        },
        orderBy: [
          { rankScore: 'desc' },
          { confidence: 'desc' },
        ],
      },
    },
  })

  if (!vlog) notFound()

  const opportunities = rankReviewQueue(vlog.opportunities)
  const publishSummary = buildTripKitPublishSummary({
    creatorId: creator.id,
    opportunities: vlog.opportunities,
    existingTripKit: vlog.tripKits[0]?.tripKit ?? null,
  })
  const memoryKeys = Array.from(
    new Set(
      opportunities
        .map((opportunity) =>
          normalizeCreatorMemoryKey(
            opportunity.candidateEntity?.canonicalLabel
              ?? opportunity.candidateEntity?.rawLabel
              ?? opportunity.title
          )
        )
        .filter(Boolean)
    )
  )

  const memoryRows = memoryKeys.length > 0
    ? await prisma.creatorMemory.findMany({
        where: {
          creatorId: creator.id,
          key: { in: memoryKeys },
        },
        select: {
          memoryType: true,
          key: true,
          valueJson: true,
        },
      })
    : []

  const memoryByKey = new Map<string, typeof memoryRows>()
  for (const memoryRow of memoryRows) {
    const existing = memoryByKey.get(memoryRow.key) ?? []
    existing.push(memoryRow)
    memoryByKey.set(memoryRow.key, existing)
  }

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 flex items-start justify-between gap-6 p-6">
        <div>
          <p className="dashboard-mirror-kicker text-xs">Review detail</p>
          <Link href="/dashboard/review" className="dashboard-mirror-subtle mt-3 inline-block text-sm hover:text-white">
            Back to review queue
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-white">{vlog.title}</h1>
          <p className="dashboard-mirror-subtle mt-2 text-sm">
            {opportunities.length} opportunity{opportunities.length !== 1 ? 'ies' : 'y'} extracted from this vlog
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PublishTripKitButton
            vlogId={vlog.id}
            disabled={!publishSummary.readyToPublish}
            actionLabel={publishSummary.actionLabel}
          />
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/82">
            {vlog.processingStatus}
          </span>
          <a
            href={vlog.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/16"
          >
            Open source vlog
          </a>
        </div>
      </div>

      <div className="dashboard-mirror-card mb-6 p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Publish Preview</p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {publishSummary.readyToPublish
                ? publishSummary.itinerary?.title
                : 'No approved itinerary is ready to publish'}
            </h2>
            <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-sm">
              {publishSummary.readyToPublish
                ? 'Publishing will project the selected itinerary opportunity into the storefront Trip Kit.'
                : 'Approve or edit an itinerary opportunity first, then publish it here.'}
            </p>
          </div>
          {publishSummary.tripKit ? (
            <div className="rounded-2xl bg-white/8 px-4 py-3 text-sm text-white/80">
              <p className="dashboard-mirror-kicker text-xs">Current Trip Kit</p>
              <p className="mt-1 font-medium text-white">{publishSummary.tripKit.title}</p>
              <p className="dashboard-mirror-muted mt-1 text-xs">/{publishSummary.tripKit.slug}</p>
            </div>
          ) : null}
        </div>

        {publishSummary.readyToPublish ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <p className="dashboard-mirror-kicker text-xs">Source Opportunity</p>
              <p className="mt-1 text-sm text-white">{publishSummary.opportunity?.title}</p>
            </div>
            <div>
              <p className="dashboard-mirror-kicker text-xs">Days</p>
              <p className="mt-1 text-sm text-white">{publishSummary.totalDays}</p>
            </div>
            <div>
              <p className="dashboard-mirror-kicker text-xs">Activities</p>
              <p className="mt-1 text-sm text-white">{publishSummary.totalActivities}</p>
            </div>
            <div>
              <p className="dashboard-mirror-kicker text-xs">Destination</p>
              <p className="mt-1 text-sm text-white">
                {publishSummary.itinerary?.primaryCity ?? publishSummary.itinerary?.destinations?.[0] ?? 'Not set'}
              </p>
            </div>
          </div>
        ) : null}

        {publishSummary.republishChanges.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-200/80">Republish Changes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {publishSummary.republishChanges.map((change) => (
                <span
                  key={change}
                  className="rounded-full border border-amber-400/20 bg-black/20 px-2 py-1 text-xs text-amber-100"
                >
                  {change}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {opportunities.length === 0 ? (
        <div className="dashboard-mirror-card p-10 text-center">
          <p className="dashboard-mirror-subtle text-sm">No reviewable opportunities are attached to this vlog yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {opportunities.map((opportunity) => (
            <div key={opportunity.id} className="dashboard-mirror-card p-5">
              {(() => {
                const memoryKey = normalizeCreatorMemoryKey(
                  opportunity.candidateEntity?.canonicalLabel
                    ?? opportunity.candidateEntity?.rawLabel
                    ?? opportunity.title
                )
                const memoryHints = buildCreatorMemoryHints(memoryByKey.get(memoryKey))
                const reviewRecommendation = getReviewRecommendation(opportunity)
                const reviewRecommendationLabel = formatReviewRecommendationLabel(reviewRecommendation)
                const reviewRecommendationReason = getReviewRecommendationReason(opportunity)
                const multimodalEvidenceLabel = getMultimodalEvidenceLabel(opportunity)

                return (
                  <>
              <div className="mb-4 flex items-start justify-between gap-6">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/78">
                      {formatOpportunityTypeLabel(opportunity.opportunityType)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/78">
                      Confidence {formatPercent(opportunity.confidence)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/78">
                      Rank {(opportunity.rankScore ?? 0).toFixed(2)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/78">
                      {opportunity.reviewState}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-white">{opportunity.title}</h2>
                  {opportunity.description ? (
                    <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-sm">{opportunity.description}</p>
                  ) : null}
                </div>
                <ReviewDecisionButtons opportunityId={opportunity.id} reviewState={opportunity.reviewState} />
              </div>

              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div>
                  <p className="dashboard-mirror-kicker text-xs">Entity</p>
                  <p className="mt-1 text-sm text-white">
                    {opportunity.candidateEntity?.canonicalLabel
                      ?? opportunity.candidateEntity?.rawLabel
                      ?? 'Graph-only opportunity'}
                  </p>
                </div>
                <div>
                  <p className="dashboard-mirror-kicker text-xs">Evidence Sources</p>
                  <p className="mt-1 text-sm text-white">{summarizeEvidenceSources(opportunity)}</p>
                </div>
                <div>
                  <p className="dashboard-mirror-kicker text-xs">Temporal Anchor</p>
                  <p className="mt-1 text-sm text-white">
                    {opportunity.candidateEntity
                      ? `${Math.round(opportunity.candidateEntity.startSec)}s - ${Math.round(opportunity.candidateEntity.endSec)}s`
                      : 'Graph-level opportunity'}
                  </p>
                </div>
              </div>

              {memoryHints.length > 0 ? (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {memoryHints.map((hint) => (
                    <span key={hint} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
                      {hint}
                    </span>
                  ))}
                </div>
              ) : null}

              {reviewRecommendationLabel ? (
                <div className="mb-4">
                  <span className={`rounded-full border px-2 py-1 text-xs ${reviewRecommendationTone(reviewRecommendation)}`}>
                    {reviewRecommendationLabel}
                  </span>
                  {reviewRecommendationReason ? (
                    <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-xs">{reviewRecommendationReason}</p>
                  ) : null}
                </div>
              ) : null}

              {multimodalEvidenceLabel ? (
                <div className="mb-4">
                  <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-xs text-violet-100">
                    {multimodalEvidenceLabel}
                  </span>
                </div>
              ) : null}

              <ReviewEditForm
                opportunityId={opportunity.id}
                initialTitle={opportunity.title}
                initialDescription={opportunity.description}
              />
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
