import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { earningsByProvider, sumCommissionEarnings } from '@/lib/affiliateAnalytics'
import {
  buildRecentPerformanceSummary,
  buildTopEarningKitsLast7d,
  formatCurrencyFromCents,
} from '@/lib/dashboardAnalytics'

export default async function DashboardAnalyticsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [
    kitPerf,
    linkPerf,
    commissions,
    clicksLast7d,
    conversionsLast7d,
    earningsLast7d,
    clickGroups,
    commissionGroups,
  ] = await Promise.all([
    prisma.tripKit.findMany({
      where: { creatorId: creator.id, isPublished: true },
      select: {
        id: true,
        title: true,
        slug: true,
        viewCount: true,
        clickCount: true,
        saveCount: true,
        conversionCount: true,
        estimatedEarnings: true,
      },
      orderBy: { viewCount: 'desc' },
      take: 20,
    }),
    prisma.affiliateLink.findMany({
      where: { creatorId: creator.id },
      select: {
        id: true,
        targetName: true,
        provider: true,
        clickCount: true,
        conversionCount: true,
        totalEarnings: true,
      },
      orderBy: { totalEarnings: 'desc' },
      take: 10,
    }),
    prisma.commission.findMany({
      where: { creatorId: creator.id, createdAt: { gte: thirtyDaysAgo } },
      select: { provider: true, creatorEarnings: true, status: true },
    }),
    prisma.clickEvent.count({
      where: { creatorId: creator.id, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.commission.count({
      where: { creatorId: creator.id, convertedAt: { gte: sevenDaysAgo } },
    }),
    prisma.commission.aggregate({
      where: { creatorId: creator.id, convertedAt: { gte: sevenDaysAgo } },
      _sum: { creatorEarnings: true },
    }),
    prisma.clickEvent.groupBy({
      by: ['tripKitId'],
      where: { creatorId: creator.id, createdAt: { gte: sevenDaysAgo }, tripKitId: { not: null } },
      _count: { tripKitId: true },
    }),
    prisma.commission.groupBy({
      by: ['affiliateLinkId'],
      where: { creatorId: creator.id, convertedAt: { gte: sevenDaysAgo } },
      _count: { affiliateLinkId: true },
      _sum: { creatorEarnings: true },
    }),
  ])

  const providerTotals = earningsByProvider(commissions)
  const total30d = sumCommissionEarnings(commissions)
  const recentSummary = buildRecentPerformanceSummary({
    clicksLast7d,
    conversionsLast7d,
    earningsLast7dCents: earningsLast7d._sum.creatorEarnings ?? 0,
  })

  const topKitsLast7d = buildTopEarningKitsLast7d({
    kits: kitPerf,
    clickGroups,
    commissionGroups,
  }).slice(0, 5)

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <p className="dashboard-mirror-kicker text-xs">Performance analytics</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Understand what people explore, click, and convert from your world.</h1>
        <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
          Keep a close read on link earnings, kit performance, and which recommendations are turning attention into action.
        </p>
        <p className="dashboard-mirror-muted mt-3 text-xs">Last 30 days · all published kits</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <SummaryCard label="Last 7d Clicks" value={recentSummary.clicksLast7d.toLocaleString()} />
        <SummaryCard
          label="Last 7d Conversions"
          value={recentSummary.conversionsLast7d.toLocaleString()}
          detail={`${recentSummary.conversionRate.toFixed(1)}% CVR`}
        />
        <SummaryCard label="Last 7d Earnings" value={`$${recentSummary.earningsLast7dDisplay}`} />
      </div>

      <div className="dashboard-mirror-card mb-6 p-6">
        <h2 className="mb-4 font-semibold text-white">Earnings by Provider (30d)</h2>
        {Object.keys(providerTotals).length === 0 ? (
          <p className="text-sm text-white/76">No commission data yet.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(providerTotals)
              .sort((a, b) => b[1] - a[1])
              .map(([provider, amount]) => (
                <div key={provider} className="flex items-center gap-4">
                  <span className="w-32 truncate text-sm text-white/74">{provider.replace(/_/g, ' ')}</span>
                  <div className="h-2 flex-1 rounded-full bg-white/8">
                    <div
                      className="h-2 rounded-full bg-white/55"
                      style={{ width: `${total30d > 0 ? (amount / total30d) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm font-medium text-white">${(amount / 100).toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="dashboard-mirror-card mb-6">
        <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-white">Top Earning Kits (7d)</h2>
        </div>
        {topKitsLast7d.length === 0 || topKitsLast7d.every((kit) => kit.recentClicks === 0 && kit.recentEarningsCents === 0) ? (
          <div className="p-8 text-center text-sm text-white/76">No recent kit activity yet.</div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {topKitsLast7d.map((kit) => (
              <div key={kit.id} className="grid grid-cols-4 items-center gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{kit.title}</p>
                  <p className="text-xs text-white/66">/{kit.slug}</p>
                </div>
                <Metric value={kit.recentClicks.toLocaleString()} label="recent clicks" />
                <Metric value={kit.recentConversions.toLocaleString()} label="recent conversions" />
                <Metric value={`$${formatCurrencyFromCents(kit.recentEarningsCents)}`} label="recent earned" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dashboard-mirror-card mb-6">
        <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-white">Kit Performance</h2>
        </div>
        {kitPerf.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/76">No published kits yet.</div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            <div className="grid grid-cols-5 px-5 py-2 text-xs uppercase tracking-wider text-white/60">
              <span className="col-span-2">Kit</span>
              <span className="text-right">Views</span>
              <span className="text-right">Clicks</span>
              <span className="text-right">Earned</span>
            </div>
            {kitPerf.map((kit) => (
              <div key={kit.id} className="grid grid-cols-5 items-center px-5 py-3">
                <span className="col-span-2 truncate pr-4 text-sm text-white">{kit.title}</span>
                <span className="text-right text-sm text-white/76">{kit.viewCount.toLocaleString()}</span>
                <span className="text-right text-sm text-white/76">{kit.clickCount.toLocaleString()}</span>
                <span className="text-right text-sm font-medium text-white">${kit.estimatedEarnings.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dashboard-mirror-card">
        <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-white">Top Affiliate Links</h2>
        </div>
        {linkPerf.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/76">No affiliate links yet.</div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {linkPerf.map((link) => (
              <div key={link.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-white">{link.targetName}</p>
                  <p className="text-xs text-white/66">{link.provider.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <Metric value={link.clickCount.toLocaleString()} label="clicks" />
                  <Metric value={link.conversionCount.toString()} label="sales" />
                  <Metric value={`$${link.totalEarnings.toFixed(2)}`} label="earned" />
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

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-right">
      <p className="text-2xl font-semibold tracking-tight text-[#f7f1e4]">{value}</p>
      <p className="dashboard-mirror-subtle text-xs">{label}</p>
    </div>
  )
}
