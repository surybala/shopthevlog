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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Trip Kits</h1>
          <p className="text-white/40 mt-1 text-sm">
            {kits.length} kit{kits.length !== 1 ? 's' : ''}
            {limit !== null && ` · ${creator.plan} plan: ${kits.length}/${limit}`}
          </p>
        </div>
        {atLimit ? (
          <div className="flex items-center gap-3">
            <p className="text-xs text-white/40">Upgrade to PRO for unlimited kits</p>
            <Link href="/dashboard/settings?tab=billing" className="btn-primary text-sm">Upgrade</Link>
          </div>
        ) : (
          <Link href="/dashboard/kits/new" className="btn-primary text-sm">+ New Kit</Link>
        )}
      </div>

      {kits.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <p className="text-4xl mb-4">🗺</p>
          <h2 className="text-lg font-semibold text-white mb-2">No Trip Kits yet</h2>
          <p className="text-white/40 text-sm mb-6 max-w-sm mx-auto">
            Create your first Trip Kit manually, or connect YouTube to let AI generate them from your vlog catalog.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/dashboard/kits/new" className="btn-primary text-sm">Create manually</Link>
            <Link href="/dashboard/settings?tab=channels" className="btn-ghost text-sm">Connect YouTube</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {kits.map(kit => (
            <div key={kit.id} className="glass-card p-5 flex items-center gap-4">
              {/* Cover */}
              <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 shrink-0 overflow-hidden">
                {kit.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kit.coverImageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🗺</div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-white truncate">{kit.title}</h3>
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
                    kit.isPublished ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'
                  }`}>
                    {kit.isPublished ? 'Published' : 'Draft'}
                  </span>
                  {kit.generatedByAI && (
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">AI</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-white/40">
                  {kit.primaryCity && <span>{kit.primaryCity}</span>}
                  {kit.durationDays && <span>{kit.durationDays}d</span>}
                  <span>{kit._count.days} days planned</span>
                  <span>{kit._count.affiliateLinks} links</span>
                  <span className="capitalize">{kit.accessTier.toLowerCase()} access</span>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">{kit.viewCount.toLocaleString()}</p>
                  <p className="text-xs text-white/30">views</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">{kit.clickCount.toLocaleString()}</p>
                  <p className="text-xs text-white/30">clicks</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">${kit.estimatedEarnings.toFixed(0)}</p>
                  <p className="text-xs text-white/30">earned</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {kit.isPublished && (
                  <Link
                    href={`/@${creator.handle}/kits/${kit.slug}`}
                    className="text-xs text-white/40 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/30 transition-colors"
                  >
                    View ↗
                  </Link>
                )}
                <Link
                  href={`/dashboard/kits/${kit.id}`}
                  className="text-xs text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
                >
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
