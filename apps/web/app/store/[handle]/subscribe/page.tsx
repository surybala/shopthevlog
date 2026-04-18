import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import FollowButton from '@/components/FollowButton'
import { getStorefrontTheme } from '@/lib/storefrontThemes'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Subscribe - ${creator?.displayName ?? params.handle} - VlogShopper` }
}

export default async function SubscribePage({ params }: { params: { handle: string } }) {
  const [creator, supabaseData] = await Promise.all([
    prisma.creator.findUnique({
      where: { handle: params.handle },
      include: { tiers: { where: { isActive: true }, orderBy: { monthlyPrice: 'asc' } } },
    }),
    createSupabaseServer().auth.getUser(),
  ])

  if (!creator || !creator.isPublished) notFound()

  const user = supabaseData.data.user
  const theme = getStorefrontTheme(creator.storefrontTheme)

  let initialFollowing = false
  if (user) {
    const subscriber = await prisma.subscriber.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (subscriber) {
      const follow = await prisma.follow.findUnique({
        where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
        select: { id: true },
      })
      initialFollowing = !!follow
    }
  }

  return (
    <div
      className="storefront-shell mx-auto max-w-3xl px-6 py-16"
      style={{ ...theme.cssVars, backgroundImage: `var(--storefront-page-bg), url(${theme.storefrontBackdropImageUrl})` }}
    >
      <div className="mb-12 text-center">
        {creator.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveStorageAssetUrl(creator.avatarUrl) ?? ''} alt="" className="mx-auto mb-4 h-16 w-16 rounded-full object-cover" />
        )}
        <h1 className="storefront-heading text-3xl font-bold">Subscribe to {creator.displayName}</h1>
        <p className="storefront-muted mt-2">Unlock exclusive Trip Kits and travel guides</p>
      </div>

      <div className="space-y-4">
        <div className="storefront-card p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="storefront-heading text-lg font-semibold">Free Follow</h3>
              <p className="storefront-muted mt-1 text-sm">No credit card required</p>
            </div>
            <div className="text-right">
              <p className="storefront-heading text-2xl font-bold">$0</p>
              <p className="storefront-muted text-xs">forever free</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            <li className="storefront-subtle text-sm">Access to all free Trip Kits</li>
            <li className="storefront-subtle text-sm">New kit drop notifications</li>
            <li className="storefront-subtle text-sm">Browse gear recommendations</li>
          </ul>
          <div className="mt-5 flex justify-center">
            <FollowButton
              creatorHandle={creator.handle}
              initialFollowing={initialFollowing}
              isLoggedIn={!!user}
              className="w-full justify-center"
            />
          </div>
        </div>

        {creator.tiers.map((tier, i) => (
          <div key={tier.id} className={`storefront-card p-6 ${i === 0 && creator.tiers.length > 0 ? 'ring-1 ring-[color:var(--storefront-border)]' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="storefront-heading text-lg font-semibold">{tier.name}</h3>
                  {i === 0 && (
                    <span className="storefront-chip rounded-full px-2 py-0.5 text-xs">
                      Most popular
                    </span>
                  )}
                </div>
                {tier.description && <p className="storefront-muted mt-1 text-sm">{tier.description}</p>}
              </div>
              <div className="text-right">
                <p className="storefront-heading text-2xl font-bold">${(tier.monthlyPrice / 100).toFixed(0)}</p>
                <p className="storefront-muted text-xs">per month</p>
                {tier.yearlyPrice && (
                  <p className="storefront-subtle text-xs">${(tier.yearlyPrice / 100 / 12).toFixed(0)}/mo yearly</p>
                )}
              </div>
            </div>
            {tier.perks.length > 0 && (
              <ul className="mt-4 space-y-2">
                {tier.perks.map((perk, j) => (
                  <li key={j} className="storefront-subtle text-sm">{perk}</li>
                ))}
              </ul>
            )}
            <Link href={`/api/checkout/subscribe?tierId=${tier.id}`} className="btn-primary mt-5 inline-flex w-full justify-center text-sm">
              Subscribe - ${(tier.monthlyPrice / 100).toFixed(0)}/mo
            </Link>
          </div>
        ))}

        {creator.tiers.length === 0 && (
          <div className="storefront-card storefront-muted p-8 text-center text-sm">
            Paid subscription tiers coming soon.
          </div>
        )}
      </div>

      <p className="storefront-muted mt-8 text-center text-xs">
        Cancel anytime. No hidden fees. Payments processed securely by Stripe.
      </p>
    </div>
  )
}
