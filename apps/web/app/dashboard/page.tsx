import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export default async function DashboardOverviewPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
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
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to VlogShopper</h1>
          <p className="text-white/50 mb-6">You don&apos;t have a creator profile yet. Set one up to start building your storefront.</p>
          <Link href="/dashboard/settings" className="btn-primary">Set up your profile</Link>
        </div>
      </div>
    )
  }

  const scanBadgeColor: Record<string, string> = {
    COMPLETE: 'bg-green-500/20 text-green-400',
    SCANNING: 'bg-yellow-500/20 text-yellow-400',
    QUEUED: 'bg-blue-500/20 text-blue-400',
    FAILED: 'bg-red-500/20 text-red-400',
    PENDING: 'bg-white/10 text-white/40',
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Good morning, {creator.displayName.split(' ')[0]} 👋</h1>
          <p className="text-white/40 mt-1 text-sm">Your storefront is {creator.isPublished ? 'live' : 'not yet published'}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/@${creator.handle}`} className="btn-ghost text-sm">View Storefront ↗</Link>
          <Link href="/dashboard/kits" className="btn-primary text-sm">+ New Kit</Link>
        </div>
      </div>

      {/* Scan status banner */}
      {creator.catalogScanStatus !== 'COMPLETE' && (
        <div className="glass-card p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${scanBadgeColor[creator.catalogScanStatus]}`}>
              {creator.catalogScanStatus}
            </span>
            <p className="text-sm text-white/70">
              {creator.catalogScanStatus === 'PENDING'
                ? 'Your vlog catalog scan is pending. Connect a YouTube channel to start.'
                : creator.catalogScanStatus === 'SCANNING'
                ? 'AI is scanning your vlog catalog and generating Trip Kits…'
                : creator.catalogScanStatus === 'QUEUED'
                ? 'Your catalog scan is queued and will start shortly.'
                : 'Catalog scan failed. You can re-trigger from Settings.'}
            </p>
          </div>
          {creator.catalogScanStatus === 'PENDING' && (
            <Link href="/dashboard/settings" className="text-xs text-white/50 hover:text-white">
              Connect YouTube →
            </Link>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Total Earnings</p>
          <p className="text-2xl font-bold text-white">
            ${((totalEarnings?._sum?.creatorEarnings ?? 0) / 100).toFixed(2)}
          </p>
          <p className="text-xs text-white/30 mt-1">
            ${((pendingEarnings?._sum?.creatorEarnings ?? 0) / 100).toFixed(2)} pending
          </p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Published Kits</p>
          <p className="text-2xl font-bold text-white">{creator._count.tripKits}</p>
          <Link href="/dashboard/kits" className="text-xs text-white/30 hover:text-white/60 mt-1 inline-block">
            Manage kits →
          </Link>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Subscribers</p>
          <p className="text-2xl font-bold text-white">{creator._count.subscribers}</p>
          <Link href="/dashboard/subscribers" className="text-xs text-white/30 hover:text-white/60 mt-1 inline-block">
            View subscribers →
          </Link>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Active Links</p>
          <p className="text-2xl font-bold text-white">{creator._count.affiliateLinks}</p>
          <Link href="/dashboard/affiliates" className="text-xs text-white/30 hover:text-white/60 mt-1 inline-block">
            View links →
          </Link>
        </div>
      </div>

      {/* Recent kits */}
      <div className="glass-card">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white">Recent Trip Kits</h2>
          <Link href="/dashboard/kits" className="text-xs text-white/40 hover:text-white">View all →</Link>
        </div>
        {recentKits.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-white/40 text-sm mb-4">No Trip Kits yet.</p>
            <Link href="/dashboard/kits" className="btn-primary text-sm">Create your first kit</Link>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {recentKits.map(kit => (
              <div key={kit.id} className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{kit.title}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      kit.isPublished ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'
                    }`}>
                      {kit.isPublished ? 'Published' : 'Draft'}
                    </span>
                    <span className="text-xs text-white/30">{kit.accessTier}</span>
                  </div>
                </div>
                <div className="flex items-center gap-6 shrink-0 ml-4">
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{kit.viewCount.toLocaleString()}</p>
                    <p className="text-xs text-white/30">views</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{kit.clickCount.toLocaleString()}</p>
                    <p className="text-xs text-white/30">clicks</p>
                  </div>
                  <Link
                    href={`/dashboard/kits/${kit.id}`}
                    className="text-xs text-white/40 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/30 transition-colors"
                  >
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
