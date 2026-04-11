import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export default async function DashboardKitsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const kits = await prisma.tripKit.findMany({
    where: { creatorId: creator.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { affiliateLinks: true, days: true } },
    },
  })

  const planLimits: Record<string, number | null> = { FREE: 3, PRO: null, STUDIO: null }
  const limit = planLimits[creator.plan]
  const atLimit = limit !== null && kits.length >= limit

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Trip Kit library</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Shape the travel guides your audience keeps coming back to.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
              Manage every published and draft Trip Kit, keep an eye on plan limits, and refine the experiences that convert best.
            </p>
            <p className="dashboard-mirror-muted mt-3 text-xs">
              {kits.length} kit{kits.length !== 1 ? 's' : ''}
              {limit !== null ? ` · ${creator.plan} plan: ${kits.length}/${limit}` : ` · ${creator.plan} plan`}
            </p>
          </div>
          {atLimit ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-[#17332d]/68">Upgrade to PRO for unlimited kits.</p>
              <Link href="/dashboard/settings?tab=billing" className="btn-primary text-sm">Upgrade</Link>
            </div>
          ) : (
            <Link href="/dashboard/kits/new" className="btn-primary text-sm">+ New Kit</Link>
          )}
        </div>
      </div>

      {kits.length === 0 ? (
        <div className="dashboard-mirror-card p-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#17332d]/8 text-2xl text-[#17332d]/88">
            K
          </div>
          <h2 className="mb-2 text-lg font-semibold text-[#17332d]">No Trip Kits yet</h2>
          <p className="mx-auto mb-6 max-w-sm text-sm text-[#17332d]/72">
            Create your first Trip Kit manually, or connect YouTube and let the AI pipeline turn your vlogs into bookable itineraries.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/dashboard/kits/new" className="btn-primary text-sm">Create manually</Link>
            <Link href="/dashboard/settings?tab=channels" className="btn-ghost text-sm">Connect YouTube</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {kits.map((kit) => (
            <div key={kit.id} className="dashboard-mirror-card flex items-center gap-4 p-5">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-[#17332d]/8">
                {kit.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kit.coverImageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#17332d]/82">
                    KIT
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-[#17332d]">{kit.title}</h3>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    kit.isPublished ? 'bg-green-500/18 text-green-900' : 'bg-[#17332d]/8 text-[#17332d]/70'
                  }`}>
                    {kit.isPublished ? 'Published' : 'Draft'}
                  </span>
                  {kit.generatedByAI ? (
                    <span className="shrink-0 rounded bg-sky-500/16 px-1.5 py-0.5 text-xs text-sky-900">AI generated</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-[#17332d]/64">
                  {kit.primaryCity ? <span>{kit.primaryCity}</span> : null}
                  {kit.durationDays ? <span>{kit.durationDays} days</span> : null}
                  <span>{kit._count.days} planned days</span>
                  <span>{kit._count.affiliateLinks} affiliate links</span>
                  <span className="capitalize">{kit.accessTier.toLowerCase()} access</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-6">
                <Metric value={kit.viewCount.toLocaleString()} label="views" />
                <Metric value={kit.clickCount.toLocaleString()} label="clicks" />
                <Metric value={`$${kit.estimatedEarnings.toFixed(0)}`} label="earned" />
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {kit.isPublished ? (
                  <Link href={`/@${creator.handle}/kits/${kit.slug}`} className="dashboard-action-chip text-xs">
                    View {'->'}
                  </Link>
                ) : null}
                <Link href={`/dashboard/kits/${kit.id}`} className="dashboard-action-chip text-xs">
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-right">
      <p className="text-2xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      <p className="dashboard-mirror-subtle text-xs">{label}</p>
    </div>
  )
}
