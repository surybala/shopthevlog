import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import {
  getTripKitAccessReasonLabel,
  getViewerCreatorAccessLevel,
  rankTripKitsForViewer,
  tripKitRankingOrder,
} from '@/lib/ranking'
import { createSupabaseServer } from '@/lib/supabase/server'
import AccessBadge from '@/components/AccessBadge'
import { getStorefrontTheme } from '@/lib/storefrontThemes'
import { getTripKitCardImageUrl } from '@/lib/tripKitImages'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Trip Kits - ${creator?.displayName ?? params.handle} - TripMirror` }
}

export default async function StorefrontKitsPage({ params }: { params: { handle: string } }) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    include: {
      tripKits: {
        where: { isPublished: true },
        orderBy: tripKitRankingOrder,
        select: {
          id: true,
          title: true,
          slug: true,
          coverImageUrl: true,
          sourceVlogs: {
            take: 1,
            select: {
              vlog: {
                select: {
                  thumbnailUrl: true,
                },
              },
            },
          },
          primaryCity: true,
          countries: true,
          cities: true,
          durationDays: true,
          accessTier: true,
          isFeatured: true,
          viewCount: true,
          saveCount: true,
          estimatedBudgetLow: true,
          estimatedBudgetHigh: true,
          travelStyle: true,
          description: true,
          generatedByAI: true,
        },
      },
    },
  })

  if (!creator || !creator.isPublished) notFound()

  let accessLevel = getViewerCreatorAccessLevel({
    isFollowing: false,
    hasPremiumSubscription: false,
  })

  if (user) {
    const [viewerCreator, subscriber] = await Promise.all([
      prisma.creator.findUnique({ where: { userId: user.id }, select: { id: true } }),
      prisma.subscriber.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ])

    if (viewerCreator?.id === creator.id) {
      accessLevel = getViewerCreatorAccessLevel({
        isFollowing: false,
        hasPremiumSubscription: false,
        isOwner: true,
      })
    } else if (subscriber) {
      const [follow, subscription] = await Promise.all([
        prisma.follow.findUnique({
          where: {
            subscriberId_creatorId: {
              subscriberId: subscriber.id,
              creatorId: creator.id,
            },
          },
          select: { id: true },
        }),
        prisma.subscription.findFirst({
          where: { subscriberId: subscriber.id, creatorId: creator.id, status: 'ACTIVE' },
          select: { tier: { select: { kitAccess: true } } },
        }),
      ])

      accessLevel = getViewerCreatorAccessLevel({
        isFollowing: !!follow || !!subscription,
        hasPremiumSubscription: subscription?.tier.kitAccess === 'PREMIUM',
      })
    }
  }

  const rankedTripKits = rankTripKitsForViewer(
    creator.tripKits.map((kit) => ({ ...kit, creatorId: creator.id })),
    { [creator.id]: accessLevel },
  )
  const theme = getStorefrontTheme(creator.storefrontTheme)

  return (
    <div
      className="storefront-shell mx-auto max-w-6xl px-6 py-12"
      style={{ ...theme.cssVars, backgroundImage: `var(--storefront-page-bg), url(${theme.storefrontBackdropImageUrl})` }}
    >
      <div className="mb-10">
        <Link href={`/@${creator.handle}`} className="storefront-muted mb-4 inline-block text-sm hover:text-[var(--storefront-text)]">
          &larr; {creator.displayName}
        </Link>
        <h1 className="storefront-heading text-3xl font-bold">All Trip Kits</h1>
        <p className="storefront-muted mt-1">{rankedTripKits.length} kits by {creator.displayName}</p>
      </div>

      {rankedTripKits.length === 0 ? (
        <div className="py-24 text-center">
          <p className="storefront-muted">No kits published yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {rankedTripKits.map((kit) => (
            <Link key={kit.id} href={`/@${creator.handle}/kits/${kit.slug}`} className="storefront-card group overflow-hidden">
              <div className="storefront-surface relative aspect-video overflow-hidden border-0">
                {getTripKitCardImageUrl(kit) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getTripKitCardImageUrl(kit) ?? ''}
                    alt={kit.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(135deg,rgba(255,255,255,0.24),rgba(23,51,45,0.16),rgba(210,156,92,0.24))]" />
                )}
                <div className="absolute right-2 top-2 flex gap-1">
                  {kit.isFeatured && (
                    <span className="rounded-full px-2 py-0.5 text-xs text-[#fff6ee]" style={{ background: 'var(--storefront-text)' }}>
                      Featured
                    </span>
                  )}
                  {kit.accessTier !== 'FREE' && (
                    <AccessBadge label={kit.accessTier === 'FOLLOWER' ? 'Follow' : 'Premium'} />
                  )}
                  {getTripKitAccessReasonLabel(kit.accessTier, accessLevel) && (
                    <AccessBadge
                      label={getTripKitAccessReasonLabel(kit.accessTier, accessLevel)!}
                      tone="reason"
                      className="text-[11px]"
                    />
                  )}
                  {kit.generatedByAI && (
                    <span className="rounded-full px-2 py-0.5 text-xs text-[#fff6ee]" style={{ background: 'color-mix(in srgb, var(--storefront-text) 80%, transparent)' }}>
                      AI
                    </span>
                  )}
                </div>
              </div>
              <div className="p-5">
                <h3 className="storefront-heading line-clamp-2 font-semibold leading-snug group-hover:opacity-80">
                  {kit.title}
                </h3>
                {kit.description && <p className="storefront-muted mt-1.5 line-clamp-2 text-sm">{kit.description}</p>}
                <div className="storefront-muted mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {kit.countries.map((country) => (
                    <span key={country} className="storefront-chip rounded px-2 py-0.5">
                      {country}
                    </span>
                  ))}
                  {kit.durationDays && <span>{kit.durationDays}d</span>}
                  {kit.estimatedBudgetLow && <span>from ${kit.estimatedBudgetLow.toLocaleString()}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
