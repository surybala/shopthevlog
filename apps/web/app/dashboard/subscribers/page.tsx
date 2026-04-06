import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export default async function DashboardSubscribersPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const [subscriptions, follows, tiers] = await Promise.all([
    prisma.subscription.findMany({
      where: { creatorId: creator.id, status: 'ACTIVE' },
      include: {
        tier: { select: { name: true, monthlyPrice: true } },
        subscriber: { select: { displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.follow.count({ where: { creatorId: creator.id } }),
    prisma.subscriptionTier.findMany({
      where: { creatorId: creator.id, isActive: true },
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
      orderBy: { monthlyPrice: 'asc' },
    }),
  ])

  const mrr = subscriptions.reduce((acc, s) => acc + s.tier.monthlyPrice, 0)

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Subscribers</h1>
        <p className="text-white/40 mt-1 text-sm">{follows.toLocaleString()} followers · {subscriptions.length} paid subscribers</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Free Followers</p>
          <p className="text-2xl font-bold text-white">{follows.toLocaleString()}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Paid Subscribers</p>
          <p className="text-2xl font-bold text-white">{subscriptions.length}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">MRR</p>
          <p className="text-2xl font-bold text-white">${(mrr / 100).toFixed(0)}</p>
          <p className="text-xs text-white/30 mt-1">monthly recurring revenue</p>
        </div>
      </div>

      {/* Tier breakdown */}
      {tiers.length > 0 && (
        <div className="glass-card p-6 mb-6">
          <h2 className="font-semibold text-white mb-4">Tier Breakdown</h2>
          <div className="space-y-3">
            {tiers.map(tier => (
              <div key={tier.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{tier.name}</p>
                  <p className="text-xs text-white/40">${(tier.monthlyPrice / 100).toFixed(0)}/mo</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{tier._count.subscriptions}</p>
                  <p className="text-xs text-white/30">subscribers</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscriber list */}
      <div className="glass-card">
        <div className="p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">Paid Subscribers</h2>
        </div>
        {subscriptions.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">No paid subscribers yet.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {subscriptions.map(sub => (
              <div key={sub.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  {sub.subscriber.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sub.subscriber.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/60">
                      {sub.subscriber.displayName[0]}
                    </div>
                  )}
                  <p className="text-sm text-white">{sub.subscriber.displayName}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/60">{sub.tier.name}</span>
                  <p className="text-xs text-white/30">${(sub.tier.monthlyPrice / 100).toFixed(0)}/mo</p>
                  <p className="text-xs text-white/30">since {new Date(sub.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
