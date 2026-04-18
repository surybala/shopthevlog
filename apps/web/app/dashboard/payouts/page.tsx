import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import {
  calculateSubscriberRunRate,
  formatUsdFromCents,
  getNextMonthlyPayoutDate,
  summarizeCommissionStatus,
} from '@/lib/creatorRevenue'

type StripeAccountSnapshot = {
  connected: boolean
  payoutsEnabled: boolean
  chargesEnabled: boolean
  detailsSubmitted: boolean
  requiresAction: boolean
  currentlyDueCount: number
}

async function getStripeAccountSnapshot(stripeAccountId: string | null): Promise<StripeAccountSnapshot | null> {
  if (!stripeAccountId) return null
  if (!process.env.STRIPE_SECRET_KEY) return null

  const { stripe } = await import('@/lib/stripe')
  const account = await stripe.accounts.retrieve(stripeAccountId)
  return {
    connected: true,
    payoutsEnabled: account.payouts_enabled,
    chargesEnabled: account.charges_enabled,
    detailsSubmitted: account.details_submitted,
    requiresAction: (account.requirements?.currently_due?.length ?? 0) > 0,
    currentlyDueCount: account.requirements?.currently_due?.length ?? 0,
  }
}

function getAccountBadge(snapshot: StripeAccountSnapshot | null) {
  if (!snapshot) return { label: 'Stripe not connected', className: 'bg-[rgba(23,51,45,0.08)] text-[#17332d]/72' }
  if (snapshot.payoutsEnabled && snapshot.chargesEnabled) return { label: 'Payouts enabled', className: 'bg-emerald-500/16 text-emerald-950' }
  if (snapshot.requiresAction) return { label: 'Needs action', className: 'bg-amber-500/18 text-amber-950' }
  return { label: 'Connected', className: 'bg-blue-500/14 text-blue-950' }
}

export default async function DashboardPayoutsPage({
  searchParams,
}: {
  searchParams?: { stripe?: string }
}) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
  })
  if (!creator) redirect('/dashboard')

  const [commissions, subscriptionRevenue, stripeSnapshot] = await Promise.all([
    prisma.commission.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        affiliateLink: {
          select: { targetName: true },
        },
        attributedTripKit: {
          select: { title: true, slug: true },
        },
      },
    }),
    prisma.subscription.findMany({
      where: { creatorId: creator.id, status: { in: ['ACTIVE', 'TRIALING'] } },
      include: {
        tier: {
          select: { monthlyPrice: true, yearlyPrice: true },
        },
      },
    }),
    getStripeAccountSnapshot(creator.stripeAccountId),
  ])

  if (stripeSnapshot && stripeSnapshot.payoutsEnabled !== creator.payoutsEnabled) {
    await prisma.creator.update({
      where: { id: creator.id },
      data: { payoutsEnabled: stripeSnapshot.payoutsEnabled },
    })
  }

  const totals = summarizeCommissionStatus(commissions)
  const subscriberRunRateCents = calculateSubscriberRunRate(subscriptionRevenue)
  const payoutThresholdCents = 2500
  const nextPayoutDate = getNextMonthlyPayoutDate()
  const topAttribution = commissions.reduce<Record<string, number>>((acc, commission) => {
    const title = commission.attributedTripKit?.title ?? 'Unattributed'
    acc[title] = (acc[title] ?? 0) + commission.creatorEarnings
    return acc
  }, {})
  const topKits = Object.entries(topAttribution)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
  const badge = getAccountBadge(stripeSnapshot)

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Creator payouts</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">See what is earning now, what is ready to pay out, and what still needs setup.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
              Affiliate commissions, subscriber run-rate, and Stripe payout readiness all live here so creators know exactly how close they are to getting paid.
            </p>
            <p className="dashboard-mirror-muted mt-3 text-xs">
              Monthly payout review on the 1st · ${ (payoutThresholdCents / 100).toFixed(0) } minimum confirmed balance
            </p>
          </div>
          <div className={`rounded-full px-3 py-1.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </div>
        </div>
      </div>

      {searchParams?.stripe === 'connected' ? (
        <div className="dashboard-mirror-card mb-6 p-4 text-sm text-[#1f6b4f]">
          Stripe onboarding returned successfully. If Stripe still needs more information, you can resume setup below.
        </div>
      ) : null}

      <div className="dashboard-mirror-card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium text-[#17332d]">
              {stripeSnapshot?.payoutsEnabled
                ? 'Your payout account is ready.'
                : creator.stripeAccountId
                  ? 'Finish Stripe setup to receive creator payouts.'
                  : 'Connect Stripe to receive creator payouts.'}
            </p>
            <p className="mt-1 text-xs text-[rgba(23,51,45,0.62)]">
              {!stripeSnapshot
                ? 'Set up Stripe Express once so affiliate commissions and future subscriber payouts have a destination.'
                : stripeSnapshot.payoutsEnabled
                  ? 'Open your Stripe Express dashboard to view transfers, tax details, and banking information.'
                  : stripeSnapshot.requiresAction
                    ? `${stripeSnapshot.currentlyDueCount} detail${stripeSnapshot.currentlyDueCount === 1 ? '' : 's'} still need attention before payouts can go out.`
                    : 'Stripe is connected, but the account still needs to finish onboarding before payouts are enabled.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/api/stripe/connect/onboard"
              className="btn-primary text-sm"
            >
              {!creator.stripeAccountId ? 'Connect Stripe' : stripeSnapshot?.payoutsEnabled ? 'Refresh Stripe setup' : 'Resume onboarding'}
            </a>
            {stripeSnapshot?.connected ? (
              <a href="/api/stripe/connect/dashboard" className="btn-ghost text-sm">
                Open Stripe Dashboard
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Ready To Payout"
          value={formatUsdFromCents(totals.confirmed)}
          detail={
            totals.confirmed < payoutThresholdCents
              ? `${formatUsdFromCents(payoutThresholdCents - totals.confirmed)} until threshold`
              : 'Eligible for the next payout run'
          }
          positive={totals.confirmed >= payoutThresholdCents}
        />
        <SummaryCard
          label="Pending Review"
          value={formatUsdFromCents(totals.pending)}
          detail="Waiting on provider confirmation"
        />
        <SummaryCard
          label="Paid Out"
          value={formatUsdFromCents(totals.paid)}
          detail="Historical creator payouts"
        />
        <SummaryCard
          label="Subscriber Run-Rate"
          value={formatUsdFromCents(subscriberRunRateCents)}
          detail={`${subscriptionRevenue.length} active paying subscriber${subscriptionRevenue.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="dashboard-mirror-card p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[rgba(23,51,45,0.08)] pb-4">
            <div>
              <h2 className="font-semibold text-[#17332d]">Commission History</h2>
              <p className="mt-1 text-xs text-[rgba(23,51,45,0.58)]">
                Every confirmed affiliate conversion that contributes to your creator balance.
              </p>
            </div>
            <p className="text-xs text-[rgba(23,51,45,0.48)]">
              Next review: {nextPayoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </div>

          {commissions.length === 0 ? (
            <div className="p-8 text-center text-sm text-[rgba(23,51,45,0.62)]">
              No commissions yet. Share your storefront and Trip Kit affiliate links to start earning.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(23,51,45,0.08)]">
              {commissions.map((commission) => (
                <div key={commission.id} className="flex flex-wrap items-center justify-between gap-4 px-1 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#17332d]">
                      {commission.affiliateLink?.targetName ?? commission.provider.replace(/_/g, ' ')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[rgba(23,51,45,0.58)]">
                      <span>{commission.provider.replace(/_/g, ' ')}</span>
                      <span>{new Date(commission.createdAt).toLocaleDateString()}</span>
                      {commission.attributedTripKit ? <span>Kit: {commission.attributedTripKit.title}</span> : <span>Kit: Unattributed</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${
                      commission.status === 'PAID'
                        ? 'bg-emerald-500/16 text-emerald-950'
                        : commission.status === 'CONFIRMED'
                          ? 'bg-blue-500/14 text-blue-950'
                          : commission.status === 'PENDING'
                            ? 'bg-amber-500/18 text-amber-950'
                            : 'bg-rose-500/18 text-rose-950'
                    }`}>
                      {commission.status}
                    </span>
                    <p className="text-sm font-semibold text-[#17332d]">{formatUsdFromCents(commission.creatorEarnings)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="dashboard-mirror-card p-5">
            <h2 className="font-semibold text-[#17332d]">Top earning kits</h2>
            <p className="mt-1 text-xs text-[rgba(23,51,45,0.58)]">Which published experiences are driving the strongest commission value.</p>
            {topKits.length === 0 ? (
              <p className="mt-4 text-sm text-[rgba(23,51,45,0.62)]">No attributed kit revenue yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {topKits.map(([title, earnings]) => (
                  <div key={title} className="flex items-center justify-between rounded-xl border border-[rgba(23,51,45,0.08)] bg-white/60 px-4 py-3">
                    <p className="text-sm font-medium text-[#17332d]">{title}</p>
                    <p className="text-sm font-semibold text-[#17332d]">{formatUsdFromCents(earnings)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-mirror-card p-5">
            <h2 className="font-semibold text-[#17332d]">What still needs to happen</h2>
            <ul className="mt-4 space-y-2 text-sm text-[rgba(23,51,45,0.68)]">
              <li>• Pending commissions move into confirmed once providers send booking confirmation.</li>
              <li>• Confirmed balance becomes payout-ready after it clears the monthly threshold.</li>
              <li>• Stripe Express needs to stay active so transfers have a valid destination.</li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/dashboard/affiliates" className="btn-ghost text-sm">
                Review affiliate links
              </Link>
              <Link href="/dashboard/settings?tab=billing" className="dashboard-action-chip text-sm">
                Billing settings
              </Link>
            </div>
          </div>
        </div>
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
      <p className="text-4xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      {detail ? (
        <p className={`mt-2 text-xs ${positive ? 'text-emerald-700' : 'text-[rgba(23,51,45,0.58)]'}`}>{detail}</p>
      ) : null}
    </div>
  )
}
