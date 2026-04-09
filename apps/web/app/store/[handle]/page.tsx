import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import {
  getTripKitAccessReasonLabel,
  getViewerCreatorAccessLevel,
  partitionStorefrontTripKits,
  rankTripKitsForViewer,
  tripKitRankingOrder,
} from '@/lib/ranking'
import { createSupabaseServer } from '@/lib/supabase/server'
import AccessBadge from '@/components/AccessBadge'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true, bio: true, avatarUrl: true } })
  if (!creator) return {}
  return {
    title: `${creator.displayName} — VlogShopper`,
    description: creator.bio ?? `Travel kits by ${creator.displayName}`,
    openGraph: {
      title: creator.displayName,
      description: creator.bio ?? '',
      images: creator.avatarUrl ? [creator.avatarUrl] : [],
    },
  }
}

export default async function StorefrontHomePage({ params }: { params: { handle: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    include: {
      tripKits: {
        where: { isPublished: true },
        orderBy: tripKitRankingOrder,
        take: 12,
        select: {
          id: true,
          title: true,
          slug: true,
          coverImageUrl: true,
          primaryCity: true,
          countries: true,
          durationDays: true,
          accessTier: true,
          isFeatured: true,
          viewCount: true,
          saveCount: true,
          estimatedBudgetLow: true,
          estimatedBudgetHigh: true,
          travelStyle: true,
        },
      },
      merchandise: {
        where: { isPublished: true, isFeatured: true },
        take: 4,
        select: { id: true, title: true, slug: true, coverImageUrl: true, price: true, currency: true, type: true },
      },
      _count: { select: { subscribers: { where: { status: 'ACTIVE' } } } },
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
  const { featuredKits, recentKits } = partitionStorefrontTripKits(rankedTripKits)

  return (
    <div>
      {/* Hero */}
      <section className="py-16 px-6 border-b border-white/10">
        <div className="max-w-6xl mx-auto flex items-start gap-8">
          {creator.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatarUrl} alt={creator.displayName} className="w-24 h-24 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-3xl shrink-0">
              {creator.displayName[0]}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white mb-2">{creator.displayName}</h1>
            {creator.bio && <p className="text-white/60 max-w-xl leading-relaxed">{creator.bio}</p>}
            <div className="flex items-center gap-4 mt-4">
              {creator.location && <span className="text-sm text-white/40">📍 {creator.location}</span>}
              <span className="text-sm text-white/40">{creator._count.subscribers.toLocaleString()} subscribers</span>
              {creator.youtubeHandle && (
                <a href={`https://youtube.com/@${creator.youtubeHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white transition-colors">YouTube ↗</a>
              )}
              {creator.tiktokHandle && (
                <a href={`https://tiktok.com/@${creator.tiktokHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white transition-colors">TikTok ↗</a>
              )}
            </div>
            <div className="flex items-center gap-3 mt-5">
              <Link href={`/@${creator.handle}/subscribe`} className="btn-primary text-sm">Follow for free</Link>
              <Link href={`/@${creator.handle}/kits`} className="btn-ghost text-sm">Browse all kits</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-16">
        {/* Featured kits */}
        {featuredKits.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Featured Trip Kits</h2>
              <Link href={`/@${creator.handle}/kits`} className="text-sm text-white/40 hover:text-white">View all →</Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {featuredKits.map(kit => <KitCard key={kit.id} kit={kit} handle={creator.handle} accessLevel={accessLevel} />)}
            </div>
          </section>
        )}

        {/* Recent kits */}
        {recentKits.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Latest Drops</h2>
              <Link href={`/@${creator.handle}/kits`} className="text-sm text-white/40 hover:text-white">View all →</Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {recentKits.map(kit => <KitCard key={kit.id} kit={kit} handle={creator.handle} accessLevel={accessLevel} />)}
            </div>
          </section>
        )}

        {creator.tripKits.length === 0 && (
          <div className="text-center py-16">
            <p className="text-white/40">No kits published yet. Check back soon!</p>
          </div>
        )}

        {/* Featured merchandise */}
        {creator.merchandise.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Shop</h2>
              <Link href={`/@${creator.handle}/shop`} className="text-sm text-white/40 hover:text-white">View all →</Link>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {creator.merchandise.map(item => (
                <Link key={item.id} href={`/@${creator.handle}/shop/${item.slug}`} className="glass-card overflow-hidden group">
                  <div className="aspect-square bg-white/5">
                    {item.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">👕</div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-white truncate">{item.title}</p>
                    {item.price !== null && (
                      <p className="text-xs text-white/50 mt-0.5">${(item.price / 100).toFixed(0)}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function KitCard({ kit, handle }: {
  kit: {
    id: string; title: string; slug: string; coverImageUrl: string | null
    primaryCity: string | null; countries: string[]; durationDays: number | null
    accessTier: string; saveCount: number; estimatedBudgetLow: number | null
    estimatedBudgetHigh: number | null; travelStyle: string[]
  }
  handle: string
  accessLevel: 'FREE' | 'FOLLOWER' | 'PREMIUM'
}) {
  const accessReason = getTripKitAccessReasonLabel(
    kit.accessTier as 'FREE' | 'FOLLOWER' | 'PREMIUM',
    accessLevel,
  )

  return (
    <Link href={`/@${handle}/kits/${kit.slug}`} className="glass-card overflow-hidden group">
      {/* Cover */}
      <div className="aspect-video bg-white/5 relative">
        {kit.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={kit.coverImageUrl} alt={kit.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">🗺</div>
        )}
        {kit.accessTier !== 'FREE' && (
          <AccessBadge
            label={kit.accessTier === 'FOLLOWER' ? '🔓 Follow' : '⭐ Premium'}
            className="absolute top-2 right-2"
          />
        )}
        {accessReason && (
          <AccessBadge
            label={accessReason}
            tone="reason"
            className="absolute top-2 left-2 text-[11px]"
          />
        )}
      </div>
      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-white group-hover:text-white/80 line-clamp-2 text-sm leading-snug">{kit.title}</h3>
        <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
          {kit.primaryCity && <span>{kit.primaryCity}</span>}
          {kit.durationDays && <span>{kit.durationDays}d</span>}
          {kit.estimatedBudgetLow && <span>from ${kit.estimatedBudgetLow.toLocaleString()}</span>}
        </div>
      </div>
    </Link>
  )
}
