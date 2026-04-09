import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { buildCreatorMemoryHints, normalizeCreatorMemoryKey } from '@/lib/creatorMemory'
import {
  formatReviewRecommendationLabel,
  formatOpportunityTypeLabel,
  getReviewRecommendation,
  getReviewRecommendationReason,
  rankReviewQueue,
  reviewRecommendationTone,
  summarizeEvidenceSources,
} from '@/lib/opportunityReview'
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
      opportunities: {
        where: {
          publishState: { not: 'SUPPRESSED' },
        },
        include: {
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
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <Link href="/dashboard/review" className="text-sm text-white/40 hover:text-white/70">
            Back to review queue
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-white">{vlog.title}</h1>
          <p className="mt-1 text-sm text-white/40">
            {opportunities.length} opportunity{opportunities.length !== 1 ? 'ies' : 'y'} extracted from this vlog
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
            {vlog.processingStatus}
          </span>
          <a
            href={vlog.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 transition-colors hover:border-white/30 hover:text-white"
          >
            Open source vlog
          </a>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-white/40">No reviewable opportunities are attached to this vlog yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {opportunities.map((opportunity) => (
            <div key={opportunity.id} className="glass-card p-5">
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

                return (
                  <>
              <div className="mb-4 flex items-start justify-between gap-6">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/60">
                      {formatOpportunityTypeLabel(opportunity.opportunityType)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/60">
                      Confidence {formatPercent(opportunity.confidence)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/60">
                      Rank {(opportunity.rankScore ?? 0).toFixed(2)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/60">
                      {opportunity.reviewState}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-white">{opportunity.title}</h2>
                  {opportunity.description ? (
                    <p className="mt-2 max-w-3xl text-sm text-white/60">{opportunity.description}</p>
                  ) : null}
                </div>
                <ReviewDecisionButtons opportunityId={opportunity.id} reviewState={opportunity.reviewState} />
              </div>

              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/30">Entity</p>
                  <p className="mt-1 text-sm text-white">
                    {opportunity.candidateEntity?.canonicalLabel
                      ?? opportunity.candidateEntity?.rawLabel
                      ?? 'Graph-only opportunity'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/30">Evidence Sources</p>
                  <p className="mt-1 text-sm text-white">{summarizeEvidenceSources(opportunity)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/30">Temporal Anchor</p>
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
                    <p className="mt-2 max-w-3xl text-xs text-white/40">{reviewRecommendationReason}</p>
                  ) : null}
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
