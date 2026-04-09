import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import VlogsClient from './VlogsClient'

export default async function VlogsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/onboarding')
  const planConfig = getCreatorPlanConfig(creator.plan)

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Vlogs</h1>
            <p className="text-white/40 text-sm mt-1">
              {vlogs.length}/{planConfig.maxImportedVlogs} video{planConfig.maxImportedVlogs !== 1 ? 's' : ''} imported
            </p>
          </div>
          {vlogs.length === 0 && (
            <a href="/dashboard/settings?tab=channels" className="btn-primary text-sm">
              Connect a channel
            </a>
          )}
        </div>

        <VlogsClient initialVlogs={vlogs as Parameters<typeof VlogsClient>[0]['initialVlogs']} />
      </div>
    </div>
  )
}
