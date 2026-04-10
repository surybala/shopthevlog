import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export default async function DashboardPayoutsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const [commissions, pending, paid] = await Promise.all([
    prisma.commission.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.commission.aggregate({
      where: { creatorId: creator.id, status: 'PENDING' },
      _sum: { creatorEarnings: true },
    }),
    prisma.commission.aggregate({
      where: { creatorId: creator.id, status: 'PAID' },
      _sum: { creatorEarnings: true },
    }),
  ])

  const pendingCents = pending._sum.creatorEarnings ?? 0
  const paidCents = paid._sum.creatorEarnings ?? 0
  const payoutThreshold = 2500

  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-500/20 text-yellow-100',
    CONFIRMED: 'bg-blue-500/20 text-blue-100',
    PAID: 'bg-green-500/20 text-green-100',
    REVERSED: 'bg-red-500/20 text-red-100',
  }

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <p className="dashboard-mirror-kicker text-xs">Creator payouts</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Stay on top of what is pending, paid, and about to land.</h1>
        <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
          Keep Stripe connected, watch your monthly payout threshold, and audit every commission that contributes to your balance.
        </p>
        <p className="dashboard-mirror-muted mt-3 text-xs">Processed monthly on the 1st · minimum $25 threshold</p>
      </div>

      {!creator.stripeAccountId ? (
        <div className="dashboard-mirror-card mb-6 flex items-center justify-between p-5">
          <div>
            <p className="mb-0.5 text-sm font-medium text-white">Connect Stripe to receive payouts</p>
            <p className="text-xs text-white/74">Set up your Stripe account to get paid monthly for affiliate commissions and subscriptions.</p>
          </div>
          <Link href="/dashboard/settings?tab=payouts" className="btn-primary ml-4 shrink-0 text-sm">Connect Stripe</Link>
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-3 gap-4">
        <SummaryCard
          label="Pending Balance"
          value={`$${(pendingCents / 100).toFixed(2)}`}
          detail={pendingCents < payoutThreshold ? `$${((payoutThreshold - pendingCents) / 100).toFixed(2)} until next payout` : 'Ready for payout'}
          positive={pendingCents >= payoutThreshold}
        />
        <SummaryCard label="Total Paid Out" value={`$${(paidCents / 100).toFixed(2)}`} />
        <SummaryCard
          label="Next Payout"
          value={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          detail="if balance >= $25"
        />
      </div>

      <div className="dashboard-mirror-card">
        <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-white">Commission History</h2>
        </div>
        {commissions.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/76">No commissions yet. Share your Trip Kit affiliate links to start earning.</div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {commissions.map((commission) => (
              <div key={commission.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-white">{commission.provider.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-white/66">{new Date(commission.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[commission.status] ?? 'bg-white/10 text-white/76'}`}>
                    {commission.status}
                  </span>
                  <p className="text-sm font-semibold text-white">${(commission.creatorEarnings / 100).toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
  positive = false,
}: {
  label: string
  value: string
  detail?: string
  positive?: boolean
}) {
  return (
    <div className="dashboard-mirror-card p-5">
      <p className="dashboard-mirror-kicker mb-2 text-xs">{label}</p>
      <p className="text-4xl font-semibold tracking-tight text-[#f7f1e4]">{value}</p>
      {detail ? <p className={`mt-2 text-xs ${positive ? 'text-green-200' : 'dashboard-mirror-subtle'}`}>{detail}</p> : null}
    </div>
  )
}
