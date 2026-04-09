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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-white/40 mt-1 text-sm">Last 30 days · All published kits</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Last 7d Clicks</p>
          <p className="text-2xl font-bold text-white">{recentSummary.clicksLast7d.toLocaleString()}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Last 7d Conversions</p>
          <p className="text-2xl font-bold text-white">{recentSummary.conversionsLast7d.toLocaleString()}</p>
          <p className="text-xs text-white/30 mt-1">{recentSummary.conversionRate.toFixed(1)}% CVR</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Last 7d Earnings</p>
          <p className="text-2xl font-bold text-white">${recentSummary.earningsLast7dDisplay}</p>
        </div>
      </div>

      <div className="glass-card p-6 mb-6">
        <h2 className="font-semibold text-white mb-4">Earnings by Provider (30d)</h2>
        {Object.keys(providerTotals).length === 0 ? (
          <p className="text-white/40 text-sm">No commission data yet.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(providerTotals)
              .sort((a, b) => b[1] - a[1])
              .map(([provider, amount]) => (
                <div key={provider} className="flex items-center gap-4">
                  <span className="text-sm text-white/60 w-32 truncate">{provider.replace(/_/g, ' ')}</span>
                  <div className="flex-1 bg-white/5 rounded-full h-2">
                    <div
                      className="bg-white/40 h-2 rounded-full"
                      style={{ width: `${total30d > 0 ? (amount / total30d) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-white w-20 text-right">${(amount / 100).toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="glass-card mb-6">
        <div className="p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">Top Earning Kits (7d)</h2>
        </div>
        {topKitsLast7d.length === 0 || topKitsLast7d.every((kit) => kit.recentClicks === 0 && kit.recentEarningsCents === 0) ? (
          <div className="p-8 text-center text-white/40 text-sm">No recent kit activity yet.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {topKitsLast7d.map((kit) => (
              <div key={kit.id} className="grid grid-cols-4 px-5 py-3 items-center gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{kit.title}</p>
                  <p className="text-xs text-white/30">/{kit.slug}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{kit.recentClicks.toLocaleString()}</p>
                  <p className="text-xs text-white/30">recent clicks</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{kit.recentConversions.toLocaleString()}</p>
                  <p className="text-xs text-white/30">recent conversions</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">${formatCurrencyFromCents(kit.recentEarningsCents)}</p>
                  <p className="text-xs text-white/30">recent earned</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-card mb-6">
        <div className="p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">Kit Performance</h2>
        </div>
        {kitPerf.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">No published kits yet.</div>
        ) : (
          <div className="divide-y divide-white/10">
            <div className="grid grid-cols-5 px-5 py-2 text-xs text-white/30 uppercase tracking-wider">
              <span className="col-span-2">Kit</span>
              <span className="text-right">Views</span>
              <span className="text-right">Clicks</span>
              <span className="text-right">Earned</span>
            </div>
            {kitPerf.map((kit) => (
              <div key={kit.id} className="grid grid-cols-5 px-5 py-3 items-center">
                <span className="col-span-2 text-sm text-white truncate pr-4">{kit.title}</span>
                <span className="text-sm text-white/70 text-right">{kit.viewCount.toLocaleString()}</span>
                <span className="text-sm text-white/70 text-right">{kit.clickCount.toLocaleString()}</span>
                <span className="text-sm font-medium text-white text-right">${kit.estimatedEarnings.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-card">
        <div className="p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">Top Affiliate Links</h2>
        </div>
        {linkPerf.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">No affiliate links yet.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {linkPerf.map((link) => (
              <div key={link.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-white">{link.targetName}</p>
                  <p className="text-xs text-white/30">{link.provider.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-medium text-white">{link.clickCount.toLocaleString()}</p>
                    <p className="text-xs text-white/30">clicks</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{link.conversionCount}</p>
                    <p className="text-xs text-white/30">sales</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">${link.totalEarnings.toFixed(2)}</p>
                    <p className="text-xs text-white/30">earned</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
