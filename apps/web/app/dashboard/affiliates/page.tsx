import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { earningsByProvider, summarizeAffiliateLinks } from '@/lib/affiliateAnalytics'
import { formatUsdFromCents, summarizeCommissionStatus } from '@/lib/creatorRevenue'

const providerBadge: Record<string, string> = {
  STAY22: 'bg-orange-500/18 text-orange-950',
  BOOKING_COM: 'bg-blue-500/14 text-blue-950',
  GETYOURGUIDE: 'bg-emerald-500/14 text-emerald-950',
  VIATOR: 'bg-teal-500/14 text-teal-950',
  AMAZON: 'bg-yellow-500/18 text-yellow-950',
  SKYSCANNER: 'bg-cyan-500/14 text-cyan-950',
  KLOOK: 'bg-rose-500/14 text-rose-950',
  CUSTOM: 'bg-[rgba(23,51,45,0.08)] text-[#17332d]/76',
}

export default async function DashboardAffiliatesPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const [links, commissions] = await Promise.all([
    prisma.affiliateLink.findMany({
      where: { creatorId: creator.id },
      orderBy: { clickCount: 'desc' },
      take: 100,
      include: {
        tripKits: {
          select: { id: true, title: true },
        },
      },
    }),
    prisma.commission.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        affiliateLink: {
          select: { targetName: true },
        },
        attributedTripKit: {
          select: { title: true },
        },
      },
    }),
  ])

  const totals = summarizeAffiliateLinks(links)
  const commissionTotals = summarizeCommissionStatus(commissions)
  const providerTotals = Object.entries(earningsByProvider(commissions)).sort((left, right) => right[1] - left[1]).slice(0, 4)
  const kitTotals = commissions.reduce<Record<string, number>>((acc, commission) => {
    const title = commission.attributedTripKit?.title ?? 'Unattributed'
    acc[title] = (acc[title] ?? 0) + commission.creatorEarnings
    return acc
  }, {})
  const topKits = Object.entries(kitTotals).sort((left, right) => right[1] - left[1]).slice(0, 4)

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Revenue links</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Track what subscribers tap, book, and buy across every storefront surface.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
              See which providers convert, which kits drive revenue, and how much commission is still pending versus confirmed.
            </p>
            <p className="dashboard-mirror-muted mt-3 text-xs">{links.length} active links across your storefront and Trip Kits</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/payouts" className="dashboard-action-chip text-sm">
              View payouts
            </Link>
            <Link href="/dashboard/affiliates/new" className="btn-primary text-sm">
              + Add Link
            </Link>
          </div>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <SummaryCard label="Total Clicks" value={totals.clicks.toLocaleString()} />
        <SummaryCard label="Conversions" value={totals.conversions.toLocaleString()} detail={`${totals.conversionRate.toFixed(1)}% CVR`} />
        <SummaryCard label="Confirmed Earnings" value={formatUsdFromCents(commissionTotals.confirmed)} detail="Ready for payout review" />
        <SummaryCard label="Pending Earnings" value={formatUsdFromCents(commissionTotals.pending)} detail="Waiting on provider confirmation" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="dashboard-mirror-card p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[rgba(23,51,45,0.08)] pb-4">
            <div>
              <h2 className="font-semibold text-[#17332d]">Top revenue links</h2>
              <p className="mt-1 text-xs text-[rgba(23,51,45,0.58)]">Your highest-click and highest-earning links, with kit attribution when available.</p>
            </div>
          </div>

          {links.length === 0 ? (
            <div className="p-8 text-center text-sm text-[rgba(23,51,45,0.62)]">
              No affiliate links yet. Add hotels, experiences, and travel gear to start earning.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(23,51,45,0.08)]">
              {links.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center gap-4 px-1 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-[#17332d]">{link.targetName}</p>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${providerBadge[link.provider] ?? providerBadge.CUSTOM}`}>
                        {link.provider.replace(/_/g, ' ')}
                      </span>
                      {!link.isActive ? <span className="text-xs text-[rgba(23,51,45,0.46)]">(inactive)</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[rgba(23,51,45,0.56)]">
                      {link.city ? <span>{link.city}</span> : null}
                      <span className="font-mono">vlogshopper.com/r/r/{link.shortCode}</span>
                      {link.tripKits[0]?.title ? <span>Kit: {link.tripKits[0].title}</span> : null}
                      {link.priceFrom ? <span>{link.priceFrom}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-6">
                    <Metric value={link.clickCount.toLocaleString()} label="clicks" />
                    <Metric value={link.conversionCount.toString()} label="sales" />
                    <Metric value={`$${link.totalEarnings.toFixed(2)}`} label="earned" />
                    <a
                      href={link.affiliateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dashboard-action-chip text-sm"
                    >
                      Test link
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="dashboard-mirror-card p-5">
            <h2 className="font-semibold text-[#17332d]">Provider earnings mix</h2>
            {providerTotals.length === 0 ? (
              <p className="mt-4 text-sm text-[rgba(23,51,45,0.62)]">No confirmed commission data yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {providerTotals.map(([provider, earnings]) => (
                  <div key={provider} className="flex items-center justify-between rounded-xl border border-[rgba(23,51,45,0.08)] bg-white/60 px-4 py-3">
                    <p className="text-sm font-medium text-[#17332d]">{provider.replace(/_/g, ' ')}</p>
                    <p className="text-sm font-semibold text-[#17332d]">{formatUsdFromCents(earnings)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-mirror-card p-5">
            <h2 className="font-semibold text-[#17332d]">Top earning kits</h2>
            {topKits.length === 0 ? (
              <p className="mt-4 text-sm text-[rgba(23,51,45,0.62)]">No kit-level attribution yet.</p>
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
            <h2 className="font-semibold text-[#17332d]">Recent commission activity</h2>
            {commissions.length === 0 ? (
              <p className="mt-4 text-sm text-[rgba(23,51,45,0.62)]">No provider callbacks yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {commissions.slice(0, 4).map((commission) => (
                  <div key={commission.id} className="rounded-xl border border-[rgba(23,51,45,0.08)] bg-white/60 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#17332d]">{commission.affiliateLink?.targetName ?? commission.provider}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${
                        commission.status === 'CONFIRMED'
                          ? 'bg-blue-500/14 text-blue-950'
                          : commission.status === 'PAID'
                            ? 'bg-emerald-500/16 text-emerald-950'
                            : commission.status === 'PENDING'
                              ? 'bg-amber-500/18 text-amber-950'
                              : 'bg-rose-500/18 text-rose-950'
                      }`}>
                        {commission.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-[rgba(23,51,45,0.58)]">
                      <span>{commission.attributedTripKit?.title ?? 'Unattributed'}</span>
                      <span>{formatUsdFromCents(commission.creatorEarnings)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="dashboard-mirror-card p-5">
      <p className="dashboard-mirror-kicker mb-2 text-xs">{label}</p>
      <p className="text-4xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      {detail ? <p className="mt-2 text-xs text-[rgba(23,51,45,0.58)]">{detail}</p> : null}
    </div>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-right">
      <p className="text-2xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      <p className="text-xs text-[rgba(23,51,45,0.58)]">{label}</p>
    </div>
  )
}
