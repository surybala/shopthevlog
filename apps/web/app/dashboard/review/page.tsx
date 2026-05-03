import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { buildCreatorMemoryHints, normalizeCreatorMemoryKey } from '@/lib/creatorMemory'
import {
  buildOpportunityReviewSummary,
  formatReviewRecommendationLabel,
  formatOpportunityTypeLabel,
  getReviewRecommendation,
  getReviewRecommendationReason,
  rankReviewQueue,
  reviewRecommendationTone,
  summarizeEvidenceSources,
} from '@/lib/opportunityReview'
import ReviewDecisionButtons from './ReviewDecisionButtons'

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function reviewTone(reviewState: string) {
  switch (reviewState) {
    case 'UNREVIEWED':
      return 'bg-amber-500/20 text-amber-800'
    case 'AUTO_APPROVED':
      return 'bg-blue-500/20 text-blue-800'
    case 'APPROVED':
      return 'bg-emerald-500/20 text-emerald-800'
    case 'EDITED':
      return 'bg-cyan-500/20 text-cyan-800'
    case 'REJECTED':
      return 'bg-red-500/20 text-red-800'
    default:
      return 'bg-[#17332d]/8 text-[#17332d]/50'
  }
}

export default async function DashboardReviewPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const opportunities = await prisma.opportunity.findMany({
    where: {
      creatorId: creator.id,
      reviewState: { in: ['UNREVIEWED', 'AUTO_APPROVED', 'APPROVED', 'EDITED'] },
      publishState: { in: ['DRAFT'] },
    },
    orderBy: [{ rankScore: 'desc' }, { confidence: 'desc' }, { createdAt: 'desc' }],
    include: {
      vlog: {
        select: {
          id: true,
          title: true,
          externalUrl: true,
          thumbnailUrl: true,
        },
      },
      candidateEntity: {
        select: {
          entityType: true,
          subtype: true,
          canonicalLabel: true,
          rawLabel: true,
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
    take: 50,
  })

  const queue = rankReviewQueue(opportunities)
  const summary = buildOpportunityReviewSummary(queue)
  const memoryKeys = Array.from(
    new Set(
      queue
        .map((opportunity) =>
          normalizeCreatorMemoryKey(
            opportunity.candidateEntity?.canonicalLabel ??
              opportunity.candidateEntity?.rawLabel ??
              opportunity.title,
          ),
        )
        .filter(Boolean),
    ),
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
          <h1 className="text-2xl font-bold text-[#17332d]">Review Queue</h1>
          <p className="dashboard-mirror-subtle mt-1 text-sm">
            Review extracted opportunities before they shape the creator portal.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <SummaryBox label="Total" value={String(summary.total)} tone="text-[#17332d]" />
          <SummaryBox label="Needs Review" value={String(summary.pending)} tone="text-amber-800" />
          <SummaryBox label="Auto Approved" value={String(summary.autoApproved)} tone="text-sky-800" />
          <SummaryBox label="Approved" value={String(summary.approved)} tone="text-emerald-800" />
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="dashboard-mirror-card p-10 text-center">
          <p className="dashboard-mirror-subtle text-sm">No opportunities are waiting for review yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((opportunity) => {
            const memoryKey = normalizeCreatorMemoryKey(
              opportunity.candidateEntity?.canonicalLabel ??
                opportunity.candidateEntity?.rawLabel ??
                opportunity.title,
            )
            const memoryHints = buildCreatorMemoryHints(memoryByKey.get(memoryKey))
            const reviewRecommendation = getReviewRecommendation(opportunity)
            const reviewRecommendationLabel = formatReviewRecommendationLabel(reviewRecommendation)
            const reviewRecommendationReason = getReviewRecommendationReason(opportunity)

            return (
              <div key={opportunity.id} className="dashboard-mirror-card p-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${reviewTone(opportunity.reviewState)}`}>
                        {opportunity.reviewState}
                      </span>
                      <span className="rounded-full bg-[#17332d]/8 px-2 py-1 text-xs text-[#17332d]/78">
                        {formatOpportunityTypeLabel(opportunity.opportunityType)}
                      </span>
                      <span className="rounded-full bg-[#17332d]/8 px-2 py-1 text-xs text-[#17332d]/78">
                        Confidence {formatPercent(opportunity.confidence)}
                      </span>
                      <span className="rounded-full bg-[#17332d]/8 px-2 py-1 text-xs text-[#17332d]/78">
                        Rank {(opportunity.rankScore ?? 0).toFixed(2)}
                      </span>
                    </div>

                    <h2 className="text-lg font-semibold text-[#17332d]">{opportunity.title}</h2>
                    {opportunity.description ? (
                      <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-sm">{opportunity.description}</p>
                    ) : null}

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="dashboard-mirror-kicker text-xs">Source Vlog</p>
                        <p className="mt-1 text-sm text-[#17332d]">{opportunity.vlog.title}</p>
                      </div>
                      <div>
                        <p className="dashboard-mirror-kicker text-xs">Entity</p>
                        <p className="mt-1 text-sm text-[#17332d]">
                          {opportunity.candidateEntity?.canonicalLabel ??
                            opportunity.candidateEntity?.rawLabel ??
                            'Graph-only opportunity'}
                        </p>
                      </div>
                      <div>
                        <p className="dashboard-mirror-kicker text-xs">Evidence</p>
                        <p className="mt-1 text-sm text-[#17332d]">{summarizeEvidenceSources(opportunity)}</p>
                      </div>
                    </div>

                    {memoryHints.length > 0 ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {memoryHints.map((hint) => (
                          <span key={hint} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-900">
                            {hint}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {reviewRecommendationLabel ? (
                      <div className="mt-3">
                        <span className={`rounded-full border px-2 py-1 text-xs ${reviewRecommendationTone(reviewRecommendation)}`}>
                          {reviewRecommendationLabel}
                        </span>
                        {reviewRecommendationReason ? (
                          <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-xs">
                            {reviewRecommendationReason}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="dashboard-mirror-muted mt-4 flex flex-wrap items-center gap-4 text-xs">
                      <span>
                        {opportunity.evidences.length} linked evidence item{opportunity.evidences.length !== 1 ? 's' : ''}
                      </span>
                      {opportunity.candidateEntity ? (
                        <span>
                          {Math.round(opportunity.candidateEntity.startSec)}s - {Math.round(opportunity.candidateEntity.endSec)}s
                        </span>
                      ) : null}
                      <a
                        href={opportunity.vlog.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="dashboard-action-chip text-xs"
                      >
                        Open vlog source
                      </a>
                      <Link href={`/dashboard/review/${opportunity.vlog.id}`} className="dashboard-action-chip text-xs">
                        Review this vlog
                      </Link>
                    </div>
                  </div>

                  <ReviewDecisionButtons opportunityId={opportunity.id} reviewState={opportunity.reviewState} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryBox({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="dashboard-mirror-card flex min-h-28 min-w-28 flex-col justify-between p-4">
      <p className="dashboard-mirror-kicker min-h-[2.5rem] text-xs">{label}</p>
      <p className={`text-3xl font-semibold tracking-tight ${tone}`}>{value}</p>
    </div>
  )
}
