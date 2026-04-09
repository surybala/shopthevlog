import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import {
  buildOpportunityReviewSummary,
  formatOpportunityTypeLabel,
  rankReviewQueue,
  summarizeEvidenceSources,
} from '@/lib/opportunityReview'
import ReviewDecisionButtons from './ReviewDecisionButtons'

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function reviewTone(reviewState: string) {
  switch (reviewState) {
    case 'UNREVIEWED':
      return 'bg-amber-500/20 text-amber-300'
    case 'AUTO_APPROVED':
      return 'bg-blue-500/20 text-blue-300'
    case 'APPROVED':
      return 'bg-emerald-500/20 text-emerald-300'
    case 'EDITED':
      return 'bg-cyan-500/20 text-cyan-300'
    case 'REJECTED':
      return 'bg-red-500/20 text-red-300'
    default:
      return 'bg-white/10 text-white/50'
  }
}

export default async function DashboardReviewPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const opportunities = await prisma.opportunity.findMany({
    where: {
      creatorId: creator.id,
      reviewState: { in: ['UNREVIEWED', 'AUTO_APPROVED', 'APPROVED', 'EDITED'] },
      publishState: { not: 'SUPPRESSED' },
    },
    orderBy: [
      { rankScore: 'desc' },
      { confidence: 'desc' },
      { createdAt: 'desc' },
    ],
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

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Review Queue</h1>
          <p className="mt-1 text-sm text-white/40">
            Review extracted opportunities before they shape the storefront.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-card p-4 min-w-28">
            <p className="text-xs uppercase tracking-wider text-white/40">Total</p>
            <p className="mt-1 text-xl font-semibold text-white">{summary.total}</p>
          </div>
          <div className="glass-card p-4 min-w-28">
            <p className="text-xs uppercase tracking-wider text-white/40">Needs Review</p>
            <p className="mt-1 text-xl font-semibold text-amber-300">{summary.pending}</p>
          </div>
          <div className="glass-card p-4 min-w-28">
            <p className="text-xs uppercase tracking-wider text-white/40">Auto Approved</p>
            <p className="mt-1 text-xl font-semibold text-blue-300">{summary.autoApproved}</p>
          </div>
          <div className="glass-card p-4 min-w-28">
            <p className="text-xs uppercase tracking-wider text-white/40">Approved</p>
            <p className="mt-1 text-xl font-semibold text-emerald-300">{summary.approved}</p>
          </div>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-white/40">No opportunities are waiting for review yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((opportunity) => (
            <div key={opportunity.id} className="glass-card p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${reviewTone(opportunity.reviewState)}`}>
                      {opportunity.reviewState}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-white/60">
                      {formatOpportunityTypeLabel(opportunity.opportunityType)}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-white/60">
                      Confidence {formatPercent(opportunity.confidence)}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-white/60">
                      Rank {(opportunity.rankScore ?? 0).toFixed(2)}
                    </span>
                  </div>

                  <h2 className="text-lg font-semibold text-white">{opportunity.title}</h2>
                  {opportunity.description ? (
                    <p className="mt-2 max-w-3xl text-sm text-white/60">{opportunity.description}</p>
                  ) : null}

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-white/30">Source Vlog</p>
                      <p className="mt-1 text-sm text-white">{opportunity.vlog.title}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider text-white/30">Entity</p>
                      <p className="mt-1 text-sm text-white">
                        {opportunity.candidateEntity?.canonicalLabel
                          ?? opportunity.candidateEntity?.rawLabel
                          ?? 'Graph-only opportunity'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider text-white/30">Evidence</p>
                      <p className="mt-1 text-sm text-white">{summarizeEvidenceSources(opportunity)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/35">
                    <span>{opportunity.evidences.length} linked evidence item{opportunity.evidences.length !== 1 ? 's' : ''}</span>
                    {opportunity.candidateEntity ? (
                      <span>
                        {Math.round(opportunity.candidateEntity.startSec)}s - {Math.round(opportunity.candidateEntity.endSec)}s
                      </span>
                    ) : null}
                    <a href={opportunity.vlog.externalUrl} target="_blank" rel="noreferrer" className="text-white/50 hover:text-white">
                      Open vlog source
                    </a>
                    <Link href={`/dashboard/review/${opportunity.vlog.id}`} className="text-white/50 hover:text-white">
                      Review this vlog
                    </Link>
                  </div>
                </div>

                <ReviewDecisionButtons
                  opportunityId={opportunity.id}
                  reviewState={opportunity.reviewState}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
