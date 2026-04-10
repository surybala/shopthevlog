import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { summarizeAffiliateLinks } from '@/lib/affiliateAnalytics'

const providerColors: Record<string, string> = {
  STAY22: 'bg-orange-500/20 text-orange-100',
  BOOKING_COM: 'bg-blue-500/20 text-blue-100',
  GETYOURGUIDE: 'bg-green-500/20 text-green-100',
  VIATOR: 'bg-teal-500/20 text-teal-100',
  AMAZON: 'bg-yellow-500/20 text-yellow-100',
  SKYSCANNER: 'bg-cyan-500/20 text-cyan-100',
  KLOOK: 'bg-red-500/20 text-red-100',
  CUSTOM: 'bg-white/10 text-white/76',
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

  const totals = summarizeAffiliateLinks(links)

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Revenue links</p>
            <h1 className="mt-3 text-3xl font-bold text-white">Track what your audience taps, books, and buys.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
              Monitor affiliate performance across your kits, compare provider mix, and spot the links that deserve better placement.
            </p>
            <p className="dashboard-mirror-muted mt-3 text-xs">{links.length} links across all your kits</p>
          </div>
          <Link href="/dashboard/affiliates/new" className="btn-primary text-sm">+ Add Link</Link>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <SummaryCard label="Total Clicks" value={totals.clicks.toLocaleString()} />
        <SummaryCard
          label="Conversions"
          value={totals.conversions.toLocaleString()}
          detail={`${totals.conversionRate.toFixed(1)}% CVR`}
        />
        <SummaryCard label="Total Earned" value={`$${totals.earnings.toFixed(2)}`} />
      </div>

      {links.length === 0 ? (
        <div className="dashboard-mirror-card p-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white/90">
            LINK
          </div>
          <h2 className="mb-2 text-lg font-semibold text-white">No affiliate links yet</h2>
          <p className="mx-auto mb-6 max-w-sm text-sm text-white/76">
            Add hotels, experiences, gear, and travel utilities to your kits so subscribers can book right from your recommendations.
          </p>
          <Link href="/dashboard/affiliates/new" className="btn-primary text-sm">Add your first link</Link>
        </div>
      ) : (
        <div className="dashboard-mirror-card divide-y divide-[rgba(214,205,184,0.08)]">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">{link.targetName}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${providerColors[link.provider] ?? 'bg-white/10 text-white/76'}`}>
                    {link.provider.replace(/_/g, ' ')}
                  </span>
                  {!link.isActive ? <span className="text-xs text-white/70">(inactive)</span> : null}
                </div>
                <div className="flex items-center gap-3 text-xs text-white/66">
                  {link.city ? <span>{link.city}</span> : null}
                  <span className="font-mono">vlogshopper.com/r/r/{link.shortCode}</span>
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
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/16"
                >
                  Test {'->'}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
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
