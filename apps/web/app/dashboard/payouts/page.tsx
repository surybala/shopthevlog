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
  const PAYOUT_THRESHOLD = 2500 // $25 in cents

  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    CONFIRMED: 'bg-blue-500/20 text-blue-400',
    PAID: 'bg-green-500/20 text-green-400',
    REVERSED: 'bg-red-500/20 text-red-400',
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Payouts</h1>
        <p className="text-white/40 mt-1 text-sm">Processed monthly on the 1st. Minimum $25 threshold.</p>
      </div>

      {/* Stripe connect banner */}
      {!creator.stripeAccountId && (
        <div className="glass-card p-5 mb-6 border-yellow-500/20 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white mb-0.5">Connect Stripe to receive payouts</p>
            <p className="text-xs text-white/40">Set up your Stripe account to get paid monthly for affiliate commissions and subscriptions.</p>
          </div>
          <Link href="/dashboard/settings?tab=payouts" className="btn-primary text-sm shrink-0 ml-4">Connect Stripe</Link>
        </div>
      )}

      {/* Balance */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Pending Balance</p>
          <p className="text-2xl font-bold text-white">${(pendingCents / 100).toFixed(2)}</p>
          {pendingCents < PAYOUT_THRESHOLD ? (
            <p className="text-xs text-white/30 mt-1">${((PAYOUT_THRESHOLD - pendingCents) / 100).toFixed(2)} until next payout</p>
          ) : (
            <p className="text-xs text-green-400 mt-1">Ready for payout</p>
          )}
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Total Paid Out</p>
          <p className="text-2xl font-bold text-white">${(paidCents / 100).toFixed(2)}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Next Payout</p>
          <p className="text-2xl font-bold text-white">
            {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
          <p className="text-xs text-white/30 mt-1">if balance ≥ $25</p>
        </div>
      </div>

      {/* Commission history */}
      <div className="glass-card">
        <div className="p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">Commission History</h2>
        </div>
        {commissions.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">No commissions yet. Share your Trip Kit affiliate links to start earning.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {commissions.map(c => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-white">{c.provider.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-white/30">{new Date(c.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[c.status] ?? 'bg-white/10 text-white/40'}`}>
                    {c.status}
                  </span>
                  <p className="text-sm font-semibold text-white">${(c.creatorEarnings / 100).toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
