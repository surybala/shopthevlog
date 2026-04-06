import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Subscribe — ${creator?.displayName ?? params.handle} — VlogShopper` }
}

export default async function SubscribePage({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    include: {
      tiers: {
        where: { isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      },
    },
  })

  if (!creator || !creator.isPublished) notFound()

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="text-center mb-12">
        {creator.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover mx-auto mb-4" />
        )}
        <h1 className="text-3xl font-bold text-white">Subscribe to {creator.displayName}</h1>
        <p className="text-white/40 mt-2">Unlock exclusive Trip Kits and travel guides</p>
      </div>

      <div className="space-y-4">
        {/* Free follow tier */}
        <div className="glass-card p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-white text-lg">Free Follow</h3>
              <p className="text-white/40 text-sm mt-1">No credit card required</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-white">$0</p>
              <p className="text-xs text-white/30">forever free</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            <li className="text-sm text-white/60">✓ Access to all free Trip Kits</li>
            <li className="text-sm text-white/60">✓ New kit drop notifications</li>
            <li className="text-sm text-white/60">✓ Browse gear recommendations</li>
          </ul>
          <Link href="/login?next=follow" className="mt-5 w-full inline-flex justify-center btn-ghost text-sm">Follow for free</Link>
        </div>

        {/* Paid tiers */}
        {creator.tiers.map((tier, i) => (
          <div key={tier.id} className={`glass-card p-6 ${i === 0 && creator.tiers.length > 0 ? 'border-white/30' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-lg">{tier.name}</h3>
                  {i === 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">Most popular</span>}
                </div>
                {tier.description && <p className="text-white/40 text-sm mt-1">{tier.description}</p>}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-white">${(tier.monthlyPrice / 100).toFixed(0)}</p>
                <p className="text-xs text-white/30">per month</p>
                {tier.yearlyPrice && (
                  <p className="text-xs text-green-400">${(tier.yearlyPrice / 100 / 12).toFixed(0)}/mo yearly</p>
                )}
              </div>
            </div>
            {tier.perks.length > 0 && (
              <ul className="mt-4 space-y-2">
                {tier.perks.map((perk, j) => (
                  <li key={j} className="text-sm text-white/60">✓ {perk}</li>
                ))}
              </ul>
            )}
            <Link href={`/api/checkout/subscribe?tierId=${tier.id}`} className="mt-5 w-full inline-flex justify-center btn-primary text-sm">
              Subscribe · ${(tier.monthlyPrice / 100).toFixed(0)}/mo
            </Link>
          </div>
        ))}

        {creator.tiers.length === 0 && (
          <div className="glass-card p-8 text-center text-white/40 text-sm">
            Paid subscription tiers coming soon.
          </div>
        )}
      </div>

      <p className="text-center text-xs text-white/20 mt-8">
        Cancel anytime. No hidden fees. Payments processed securely by Stripe.
      </p>
    </div>
  )
}
