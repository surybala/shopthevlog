import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import { getCreatorProcessingQuotaSnapshot } from '@/lib/creatorProcessingQuota'
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
    },
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="dashboard-mirror-panel mb-8 flex items-center justify-between p-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Video library</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Source videos powering your storefront.</h1>
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

        <VlogsClient
          initialVlogs={vlogs as Parameters<typeof VlogsClient>[0]['initialVlogs']}
          youtubeConnected={!!creator.youtubeChannelId}
          remainingVlogSlots={Math.max(planConfig.maxImportedVlogs - vlogs.length, 0)}
        />
      </div>
    </div>
  )
}
