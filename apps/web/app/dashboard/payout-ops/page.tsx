import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import PayoutOpsTable from './PayoutOpsTable'

export const metadata = { title: 'Payout Ops - TripKits Dashboard' }

function formatUsdFromCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default async function PayoutOpsPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/dashboard/payout-ops')
  if (!isAdminUser(user)) redirect('/dashboard')

  const commissions = await prisma.commission.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 250,
    include: {
      creator: {
        select: {
          displayName: true,
          handle: true,
        },
      },
      affiliateLink: {
        select: {
          targetName: true,
        },
      },
      attributedTripKit: {
        select: {
          title: true,
        },
      },
    },
  })

  const pending = commissions.filter((commission) => commission.status === 'PENDING')
  const confirmed = commissions.filter((commission) => commission.status === 'CONFIRMED')
  const paid = commissions.filter((commission) => commission.status === 'PAID')

  const pendingTotal = pending.reduce((sum, commission) => sum + commission.creatorEarnings, 0)
  const confirmedTotal = confirmed.reduce((sum, commission) => sum + commission.creatorEarnings, 0)
  const paidTotal = paid.reduce((sum, commission) => sum + commission.creatorEarnings, 0)

  const creatorExposure = Object.entries(
    commissions.reduce<Record<string, number>>((acc, commission) => {
      const key = commission.creator.handle
      acc[key] = (acc[key] ?? 0) + commission.creatorEarnings
      return acc
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)

  const rows = commissions.map((commission) => ({
    id: commission.id,
    creatorName: commission.creator.displayName,
    creatorHandle: commission.creator.handle,
    affiliateTargetName: commission.affiliateLink.targetName,
    provider: commission.provider,
    status: commission.status,
    creatorEarnings: commission.creatorEarnings,
    createdAt: commission.createdAt,
    convertedAt: commission.convertedAt,
    paidAt: commission.paidAt,
    attributedTripKitTitle: commission.attributedTripKit?.title ?? null,
  }))

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-6 py-10">
      <div className="dashboard-mirror-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Admin payout ops</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Review pending commissions, clear payout-ready balances, and keep creator earnings moving.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-3xl text-sm">
              This queue is the operational control room for beta revenue. Confirm provider callbacks, mark creator earnings as paid, and spot any attribution drift before it becomes a support issue.
            </p>
          </div>
          <div className="rounded-full bg-[rgba(23,51,45,0.08)] px-3 py-1.5 text-xs font-medium text-[#17332d]/72">
            {commissions.length} tracked commissions
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Pending review" value={pending.length.toString()} detail={formatUsdFromCents(pendingTotal)} />
        <SummaryCard label="Ready to pay" value={confirmed.length.toString()} detail={formatUsdFromCents(confirmedTotal)} />
        <SummaryCard label="Already paid" value={paid.length.toString()} detail={formatUsdFromCents(paidTotal)} />
        <SummaryCard
          label="Largest creator exposure"
          value={creatorExposure[0] ? `@${creatorExposure[0][0]}` : 'None'}
          detail={creatorExposure[0] ? formatUsdFromCents(creatorExposure[0][1]) : 'No creator balances yet'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <PayoutOpsTable
            title="Pending commission review"
            description="These provider callbacks have landed, but ops has not yet confirmed them for creator payout readiness."
            rows={rows.filter((row) => row.status === 'PENDING')}
            actions={['confirm', 'reverse']}
          />

          <PayoutOpsTable
            title="Confirmed and ready for payout"
            description="These creator earnings are approved and can be marked paid once the transfer is complete."
            rows={rows.filter((row) => row.status === 'CONFIRMED')}
            actions={['mark_paid', 'reverse']}
          />
        </div>

        <div className="space-y-6">
          <div className="dashboard-mirror-card p-5">
            <h2 className="font-semibold text-[#17332d]">Top creator exposure</h2>
            <p className="mt-1 text-xs text-[rgba(23,51,45,0.58)]">Who currently has the most total commission value across pending, confirmed, and paid balances.</p>
            {creatorExposure.length === 0 ? (
              <p className="mt-4 text-sm text-[rgba(23,51,45,0.62)]">No commission exposure yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {creatorExposure.map(([handle, total]) => (
                  <div key={handle} className="flex items-center justify-between rounded-xl border border-[rgba(23,51,45,0.08)] bg-white/60 px-4 py-3">
                    <p className="text-sm font-medium text-[#17332d]">@{handle}</p>
                    <p className="text-sm font-semibold text-[#17332d]">{formatUsdFromCents(total)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <PayoutOpsTable
            title="Recently paid"
            description="Latest creator earnings that have already been moved to paid status."
            rows={rows.filter((row) => row.status === 'PAID').slice(0, 12)}
          />
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="dashboard-mirror-card p-5">
      <p className="dashboard-mirror-kicker mb-2 text-xs">{label}</p>
      <p className="text-4xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      <p className="mt-2 text-xs text-[rgba(23,51,45,0.58)]">{detail}</p>
    </div>
  )
}
