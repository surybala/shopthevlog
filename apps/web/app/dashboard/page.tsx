import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { buildRecentPerformanceSummary, formatCurrencyFromCents } from '@/lib/dashboardAnalytics'

export default async function DashboardOverviewPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    include: {
      _count: {
        select: {
          tripKits: { where: { isPublished: true } },
          subscribers: { where: { status: 'ACTIVE' } },
          affiliateLinks: { where: { isActive: true } },
        },
      },
    },
  })

  const totalEarnings = creator
    ? await prisma.commission.aggregate({
        where: { creatorId: creator.id },
        _sum: { creatorEarnings: true },
      })
    : null

  const pendingEarnings = creator
    ? await prisma.commission.aggregate({
        where: { creatorId: creator.id, status: 'PENDING' },
        _sum: { creatorEarnings: true },
      })
    : null

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [recentClicks, recentConversions, recentEarnings] = creator
    ? await Promise.all([
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
      ])
    : [0, 0, { _sum: { creatorEarnings: 0 } }]

  const recentKits = creator
    ? await prisma.tripKit.findMany({
        where: { creatorId: creator.id },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          slug: true,
          isPublished: true,
          viewCount: true,
          clickCount: true,
          accessTier: true,
          createdAt: true,
        },
      })
    : []

  if (!creator) {
    return (
      <div className="p-8">
        <div className="max-w-lg">
          <h1 className="mb-2 text-2xl font-bold text-[#17332d]">Welcome to VlogShopper</h1>
          <p className="dashboard-mirror-subtle mb-6">
            You do not have a creator profile yet. Set one up to start building your storefront.
          </p>
          <Link href="/dashboard/settings" className="btn-primary">
            Set up your profile
          </Link>
        </div>
      </div>
    )
  }

  const recentPerformance = buildRecentPerformanceSummary({
    clicksLast7d: recentClicks,
    conversionsLast7d: recentConversions,
    earningsLast7dCents: recentEarnings._sum.creatorEarnings ?? 0,
  })

  const scanBadgeColor: Record<string, string> = {
    COMPLETE: 'bg-green-500/18 text-green-900',
    SCANNING: 'bg-yellow-500/18 text-yellow-900',
    QUEUED: 'bg-blue-500/16 text-blue-900',
    FAILED: 'bg-red-500/18 text-red-900',
    PENDING: 'bg-[#17332d]/8 text-[#17332d]/76',
  }

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 flex items-start justify-between gap-6 p-7">
        <div>
          <p className="dashboard-mirror-kicker text-xs">Creator command center</p>
          <h1 className="mt-3 text-4xl font-bold text-[#17332d]">
            Good morning, {creator.displayName.split(' ')[0]}
          </h1>
          <p className="dashboard-mirror-subtle mt-2 text-sm">
            Your storefront is {creator.isPublished ? 'live' : 'not yet published'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <Link href={`/@${creator.handle}`} className="btn-ghost text-sm">
            {creator.isPublished ? 'View Storefront' : 'Preview Storefront'} {'->'}
          </Link>
          <Link href="/dashboard/kits" className="btn-primary text-sm">
            + New Kit
          </Link>
        </div>
      </div>

      {!creator.isPublished ? (
        <div className="dashboard-mirror-card mb-6 flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className="text-lg text-amber-800">*</span>
            <div>
              <p className="text-sm font-medium text-[#17332d]">Your storefront is unpublished</p>
              <p className="dashboard-mirror-subtle mt-0.5 text-xs">
                Publish it so your audience can find and follow you.
              </p>
            </div>
          </div>
          <Link href="/dashboard/settings" className="dashboard-action-chip text-xs">
            Publish storefront {'->'}
          </Link>
        </div>
      ) : null}

      {creator.catalogScanStatus !== 'COMPLETE' ? (
        <div className="dashboard-mirror-card mb-6 flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scanBadgeColor[creator.catalogScanStatus]}`}>
              {creator.catalogScanStatus}
            </span>
            <p className="dashboard-mirror-subtle text-sm">
              {creator.catalogScanStatus === 'PENDING'
                ? 'Your vlog catalog scan is pending. Connect a YouTube channel to start.'
                : creator.catalogScanStatus === 'SCANNING'
                  ? 'AI is scanning your vlog catalog and generating Trip Kits.'
                  : creator.catalogScanStatus === 'QUEUED'
                    ? 'Your catalog scan is queued and will start shortly.'
                    : 'Catalog scan failed. You can re-trigger from Settings.'}
            </p>
          </div>
          {creator.catalogScanStatus === 'PENDING' ? (
            <Link href="/dashboard/settings" className="dashboard-mirror-subtle text-xs hover:text-[#17332d]">
              Connect YouTube {'->'}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-4 gap-4">
        <MetricCard
          label="Total Earnings"
          value={`$${((totalEarnings?._sum?.creatorEarnings ?? 0) / 100).toFixed(2)}`}
          detail={`$${((pendingEarnings?._sum?.creatorEarnings ?? 0) / 100).toFixed(2)} pending`}
        />
        <MetricCard
          label="Published Kits"
          value={String(creator._count.tripKits)}
          detailLink={{ href: '/dashboard/kits', label: 'Manage kits ->' }}
        />
        <MetricCard
          label="Subscribers"
          value={String(creator._count.subscribers)}
          detailLink={{ href: '/dashboard/subscribers', label: 'View subscribers ->' }}
        />
        <MetricCard
          label="Active Links"
          value={String(creator._count.affiliateLinks)}
          detailLink={{ href: '/dashboard/affiliates', label: 'View links ->' }}
        />
      </div>

      <div className="dashboard-mirror-card mb-8 p-5">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="dashboard-mirror-kicker mb-1 text-xs">Last 7 Days</p>
            <p className="text-2xl font-semibold text-[#17332d]">
              ${formatCurrencyFromCents(recentPerformance.earningsLast7dCents)} earned
            </p>
          </div>
          <DashboardStat value={recentPerformance.clicksLast7d.toLocaleString()} label="clicks" />
          <DashboardStat value={recentPerformance.conversionsLast7d.toLocaleString()} label="conversions" />
          <DashboardStat value={`${recentPerformance.conversionRate.toFixed(1)}%`} label="CVR" />
        </div>
      </div>

      <div className="dashboard-mirror-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[rgba(214,205,184,0.08)] p-5">
          <h2 className="font-semibold text-[#17332d]">Recent Trip Kits</h2>
          <Link href="/dashboard/kits" className="dashboard-mirror-subtle text-xs hover:text-[#17332d]">
            View all {'->'}
          </Link>
        </div>
        {recentKits.length === 0 ? (
          <div className="p-8 text-center">
            <p className="dashboard-mirror-subtle mb-4 text-sm">No Trip Kits yet.</p>
            <Link href="/dashboard/kits" className="btn-primary text-sm">
              Create your first kit
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {recentKits.map((kit) => (
              <div key={kit.id} className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#17332d]">{kit.title}</p>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        kit.isPublished ? 'bg-green-500/18 text-green-900' : 'bg-[#17332d]/8 text-[#17332d]/76'
                      }`}
                    >
                      {kit.isPublished ? 'Published' : 'Draft'}
                    </span>
                    <span className="dashboard-mirror-muted text-xs">{kit.accessTier}</span>
                    <span className="text-xs text-[#17332d]/30">·</span>
                    <span className="dashboard-mirror-muted text-xs">{kit.createdAt.toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-6">
                  <DashboardStat value={kit.viewCount.toLocaleString()} label="views" align="right" />
                  <DashboardStat value={kit.clickCount.toLocaleString()} label="clicks" align="right" />
                  <Link href={`/dashboard/kits/${kit.id}`} className="dashboard-action-chip text-xs">
                    Edit
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  detailLink,
}: {
  label: string
  value: string
  detail?: string
  detailLink?: { href: string; label: string }
}) {
  return (
    <div className="dashboard-mirror-card p-5">
      <p className="dashboard-mirror-kicker mb-2 text-xs">{label}</p>
      <p className="text-4xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      {detail ? <p className="dashboard-mirror-subtle mt-2 text-xs">{detail}</p> : null}
      {detailLink ? (
        <Link href={detailLink.href} className="dashboard-mirror-subtle mt-2 inline-block text-xs hover:text-[#17332d]">
          {detailLink.label}
        </Link>
      ) : null}
    </div>
  )
}

function DashboardStat({
  value,
  label,
  align = 'left',
}: {
  value: string
  label: string
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <p className="text-3xl font-semibold tracking-tight text-[#17332d]">{value}</p>
      <p className="dashboard-mirror-subtle text-xs">{label}</p>
    </div>
  )
}
