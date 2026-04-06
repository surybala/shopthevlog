import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

const providerColors: Record<string, string> = {
  STAY22: 'bg-orange-500/20 text-orange-300',
  BOOKING_COM: 'bg-blue-500/20 text-blue-300',
  GETYOURGUIDE: 'bg-green-500/20 text-green-300',
  VIATOR: 'bg-teal-500/20 text-teal-300',
  AMAZON: 'bg-yellow-500/20 text-yellow-300',
  SKYSCANNER: 'bg-cyan-500/20 text-cyan-300',
  KLOOK: 'bg-red-500/20 text-red-300',
  CUSTOM: 'bg-white/10 text-white/50',
}

export default async function DashboardAffiliatesPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const links = await prisma.affiliateLink.findMany({
    where: { creatorId: creator.id },
    orderBy: { clickCount: 'desc' },
    take: 100,
  })

  const totals = links.reduce(
    (acc, l) => ({
      clicks: acc.clicks + l.clickCount,
      conversions: acc.conversions + l.conversionCount,
      earnings: acc.earnings + l.totalEarnings,
    }),
    { clicks: 0, conversions: 0, earnings: 0 }
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Affiliate Links</h1>
          <p className="text-white/40 mt-1 text-sm">{links.length} links across all your kits</p>
        </div>
        <Link href="/dashboard/affiliates/new" className="btn-primary text-sm">+ Add Link</Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Total Clicks</p>
          <p className="text-2xl font-bold text-white">{totals.clicks.toLocaleString()}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Conversions</p>
          <p className="text-2xl font-bold text-white">{totals.conversions.toLocaleString()}</p>
          <p className="text-xs text-white/30 mt-1">
            {totals.clicks > 0 ? ((totals.conversions / totals.clicks) * 100).toFixed(1) : '0'}% CVR
          </p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Total Earned</p>
          <p className="text-2xl font-bold text-white">${totals.earnings.toFixed(2)}</p>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <p className="text-4xl mb-4">🔗</p>
          <h2 className="text-lg font-semibold text-white mb-2">No affiliate links yet</h2>
          <p className="text-white/40 text-sm mb-6 max-w-sm mx-auto">
            Add links to hotels, experiences, gear, and flights inside your Trip Kits, or add standalone links here.
          </p>
          <Link href="/dashboard/affiliates/new" className="btn-primary text-sm">Add your first link</Link>
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/10">
          {links.map(link => (
            <div key={link.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-white truncate">{link.targetName}</p>
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${providerColors[link.provider] ?? 'bg-white/10 text-white/40'}`}>
                    {link.provider.replace(/_/g, ' ')}
                  </span>
                  {!link.isActive && <span className="text-xs text-white/30">(inactive)</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-white/30">
                  {link.city && <span>{link.city}</span>}
                  <span className="font-mono">vlogshopper.com/r/r/{link.shortCode}</span>
                  {link.priceFrom && <span>{link.priceFrom}</span>}
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{link.clickCount.toLocaleString()}</p>
                  <p className="text-xs text-white/30">clicks</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{link.conversionCount}</p>
                  <p className="text-xs text-white/30">sales</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">${link.totalEarnings.toFixed(2)}</p>
                  <p className="text-xs text-white/30">earned</p>
                </div>
                <a
                  href={link.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white/40 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/30 transition-colors"
                >
                  Test ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
