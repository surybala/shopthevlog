import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'

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

  const mrr = subscriptions.reduce((acc, subscription) => acc + subscription.tier.monthlyPrice, 0)

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <p className="dashboard-mirror-kicker text-xs">Audience relationships</p>
        <h1 className="mt-3 text-3xl font-bold text-white">See who follows your travel world and who pays to go deeper.</h1>
        <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
          Track followers, paid memberships, and tier momentum so you know which perks are resonating with your community.
        </p>
        <p className="dashboard-mirror-muted mt-3 text-xs">{follows.toLocaleString()} followers · {subscriptions.length} paid subscribers</p>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <SummaryCard label="Free Followers" value={follows.toLocaleString()} />
        <SummaryCard label="Paid Subscribers" value={subscriptions.length.toString()} />
        <SummaryCard label="MRR" value={`$${(mrr / 100).toFixed(0)}`} detail="monthly recurring revenue" />
      </div>

      {tiers.length > 0 ? (
        <div className="dashboard-mirror-card mb-6 p-6">
          <h2 className="mb-4 font-semibold text-white">Tier Breakdown</h2>
          <div className="space-y-3">
            {tiers.map((tier) => (
              <div key={tier.id} className="flex items-center justify-between rounded-2xl bg-white/6 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">{tier.name}</p>
                  <p className="text-xs text-white/70">${(tier.monthlyPrice / 100).toFixed(0)}/mo</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{tier._count.subscriptions}</p>
                  <p className="text-xs text-white/70">subscribers</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dashboard-mirror-card">
        <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-white">Paid Subscribers</h2>
        </div>
        {subscriptions.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/76">No paid subscribers yet.</div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  {subscription.subscriber.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveStorageAssetUrl(subscription.subscriber.avatarUrl) ?? ''} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white/85">
                      {subscription.subscriber.displayName[0]}
                    </div>
                  )}
                  <p className="text-sm font-medium text-white">{subscription.subscriber.displayName}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="rounded-full bg-white/12 px-2 py-1 text-xs text-white/84">{subscription.tier.name}</span>
                  <p className="text-xs text-white/70">${(subscription.tier.monthlyPrice / 100).toFixed(0)}/mo</p>
                  <p className="text-xs text-white/70">since {new Date(subscription.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="dashboard-mirror-card p-5">
      <p className="dashboard-mirror-kicker mb-2 text-xs">{label}</p>
      <p className="text-4xl font-semibold tracking-tight text-[#f7f1e4]">{value}</p>
      {detail ? <p className="dashboard-mirror-subtle mt-2 text-xs">{detail}</p> : null}
    </div>
  )
}
