import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import { getCreatorProcessingQuotaSnapshot } from '@/lib/creatorProcessingQuota'
import { buildImportedVlogInsight } from '@/lib/vlogInsights'
import VlogsClient from './VlogsClient'

export default async function VlogsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/onboarding')
  const planConfig = getCreatorPlanConfig(creator.plan)
  const processingQuota = getCreatorProcessingQuotaSnapshot({
    plan: creator.plan,
    used: creator.processingCreditsUsed,
    resetAt: creator.processingCreditsResetAt,
  })

  const vlogs = await prisma.vlog.findMany({
    where: { creatorId: creator.id },
    orderBy: { publishedAt: 'desc' },
    include: {
      tripKits: {
        include: {
          tripKit: {
            select: { id: true, title: true, slug: true, isPublished: true },
          },
        },
      },
      opportunities: {
        select: {
          reviewState: true,
          publishState: true,
          opportunityType: true,
        },
      },
    },
  })

  const recommendedToProcess = vlogs
    .filter((vlog) => ['PENDING', 'FAILED'].includes(vlog.processingStatus) && !vlog.tripKits.some((item) => item.tripKit.isPublished))
    .map((vlog) => ({
      id: vlog.id,
      title: vlog.title,
      insight: buildImportedVlogInsight(vlog),
    }))
    .sort((left, right) => right.insight.score - left.insight.score)
    .slice(0, 3)

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="dashboard-mirror-panel mb-8 flex items-center justify-between p-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Video library</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Source videos powering your creator portal.</h1>
            <div className="dashboard-mirror-subtle mt-2 space-y-1 text-sm">
              <p>
                {vlogs.length}/{planConfig.maxImportedVlogs} video{planConfig.maxImportedVlogs !== 1 ? 's' : ''} imported
              </p>
              <p>
                {processingQuota.remaining}/{processingQuota.limit} processing credit{processingQuota.limit !== 1 ? 's' : ''} left this month
              </p>
            </div>
          </div>
          {vlogs.length === 0 && (
            <a href="/dashboard/settings?tab=channels" className="btn-primary text-sm">
              Connect a channel
            </a>
          )}
        </div>

        {recommendedToProcess.length > 0 ? (
          <div className="dashboard-mirror-card mb-6 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="dashboard-mirror-kicker text-xs">Recommended next videos</p>
                <h2 className="mt-2 text-xl font-semibold text-[#17332d]">Use credits where the kit potential looks strongest.</h2>
              </div>
              <p className="dashboard-mirror-subtle max-w-xl text-sm">
                These picks are ranked from title, description, and prior pipeline outcomes so creators can spend processing credits more intentionally.
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {recommendedToProcess.map((item) => (
                <div key={item.id} className="rounded-[1.4rem] border border-[rgba(23,51,45,0.08)] bg-white/60 p-4">
                  <p className="line-clamp-2 text-sm font-semibold text-[#17332d]">{item.title}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-[rgba(23,51,45,0.52)]">
                    {item.insight.primaryFit}
                  </p>
                  <p className="mt-2 text-sm text-[rgba(23,51,45,0.68)]">{item.insight.headline}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[rgba(23,51,45,0.08)] px-2.5 py-1 text-xs font-medium text-[#17332d]">
                      {item.insight.recommendation}
                    </span>
                    <span className="rounded-full bg-[rgba(23,51,45,0.06)] px-2.5 py-1 text-xs text-[rgba(23,51,45,0.72)]">
                      Score {item.insight.score}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-[rgba(23,51,45,0.6)]">
                    {item.insight.reasons.map((reason) => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <VlogsClient
          initialVlogs={vlogs as Parameters<typeof VlogsClient>[0]['initialVlogs']}
          youtubeConnected={!!creator.youtubeChannelId}
          remainingVlogSlots={Math.max(planConfig.maxImportedVlogs - vlogs.length, 0)}
        />
      </div>
    </div>
  )
}
