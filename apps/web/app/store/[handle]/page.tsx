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
import { getStorefrontTheme } from '@/lib/storefrontThemes'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true, bio: true, avatarUrl: true } })
  if (!creator) return {}
  return {
    title: `${creator.displayName} - VlogShopper`,
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
  const theme = getStorefrontTheme(creator.storefrontTheme)
  const storefrontImages = [
    creator.coverImageUrl,
    creator.storefrontMoodImageUrl,
    ...creator.storefrontGalleryImages,
  ].filter(Boolean) as string[]
  const heroTitle = creator.storefrontTagline || theme.headline
  const heroBody = creator.storefrontIntro || creator.bio || theme.subheadline

  return (
    <div
      className={`relative min-h-screen overflow-hidden ${theme.pageClassName}`}
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(3,12,11,0.72) 0%, rgba(3,12,11,0.88) 42%, rgba(3,12,11,0.96) 100%), url(${theme.storefrontBackdropImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_28%)]" />

      <section className="relative px-6 pb-12 pt-10 md:pb-16 md:pt-16">
        <div className={`mx-auto max-w-6xl overflow-hidden rounded-[2rem] border ${theme.shellClassName} shadow-[0_30px_120px_rgba(0,0,0,0.35)]`}>
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className={`relative p-8 md:p-10 ${theme.heroClassName}`}>
              <div className="mt-6 flex items-start gap-4">
                {creator.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={creator.avatarUrl} alt={creator.displayName} className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-white/10" />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/10 text-3xl text-white">
                    {creator.displayName[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">{creator.displayName}</h1>
                </div>
              </div>

              <h2 className="mt-8 max-w-2xl text-3xl font-semibold leading-tight text-white md:text-5xl">
                {heroTitle}
              </h2>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/68 md:text-base">
                {heroBody}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-white/45 md:text-sm">
                {creator.location && <span>Based in {creator.location}</span>}
                <span>{creator._count.subscribers.toLocaleString()} subscribers</span>
                {creator.youtubeHandle && (
                  <a href={`https://youtube.com/@${creator.youtubeHandle}`} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">
                    YouTube {'->'}
                  </a>
                )}
                {creator.tiktokHandle && (
                  <a href={`https://tiktok.com/@${creator.tiktokHandle}`} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">
                    TikTok {'->'}
                  </a>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={`/@${creator.handle}/subscribe`} className="btn-primary text-sm">Follow for free</Link>
                <Link href={`/@${creator.handle}/kits`} className="btn-ghost text-sm">Browse all kits</Link>
              </div>
            </div>

            <div className={`border-t border-white/10 p-6 lg:border-l lg:border-t-0 ${theme.cardClassName}`}>
              <div className="grid grid-cols-2 gap-3">
                {storefrontImages.slice(0, 4).map((imageUrl, index) => (
                  <div
                    key={`${imageUrl}-${index}`}
                    className={`${index === 0 ? 'col-span-2' : ''} overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="" className={`w-full object-cover ${index === 0 ? 'h-56' : 'h-32'}`} />
                  </div>
                ))}
                {storefrontImages.length === 0 && (
                  <div className="col-span-2 flex min-h-72 items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-white/5 px-6 text-center text-sm leading-7 text-white/35">
                    This storefront will feel even more personal once the creator adds travel imagery in settings.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="relative mx-auto max-w-6xl px-6 py-12 space-y-16">
        {featuredKits.length > 0 && (
          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Featured Trip Kits</h2>
              <Link href={`/@${creator.handle}/kits`} className="text-sm text-white/40 hover:text-white">View all {'->'}</Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {featuredKits.map((kit) => (
                <KitCard
                  key={kit.id}
                  kit={kit}
                  handle={creator.handle}
                  accessLevel={accessLevel}
                  cardClassName={theme.cardClassName}
                />
              ))}
            </div>
          </section>
        )}

        {recentKits.length > 0 && (
          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Latest Drops</h2>
              <Link href={`/@${creator.handle}/kits`} className="text-sm text-white/40 hover:text-white">View all {'->'}</Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {recentKits.map((kit) => (
                <KitCard
                  key={kit.id}
                  kit={kit}
                  handle={creator.handle}
                  accessLevel={accessLevel}
                  cardClassName={theme.cardClassName}
                />
              ))}
            </div>
          </section>
        )}

        {creator.tripKits.length === 0 && (
          <div className={`rounded-[2rem] border ${theme.cardClassName} py-16 text-center`}>
            <p className="text-white/40">No kits published yet. Check back soon!</p>
          </div>
        )}
      </div>
    </div>
  )
}

function KitCard({
  kit,
  handle,
  accessLevel,
  cardClassName,
}: {
  kit: {
    id: string
    title: string
    slug: string
    coverImageUrl: string | null
    primaryCity: string | null
    countries: string[]
    durationDays: number | null
    accessTier: string
    saveCount: number
    estimatedBudgetLow: number | null
    estimatedBudgetHigh: number | null
    travelStyle: string[]
  }
  handle: string
  accessLevel: 'FREE' | 'FOLLOWER' | 'PREMIUM'
  cardClassName: string
}) {
  const accessReason = getTripKitAccessReasonLabel(
    kit.accessTier as 'FREE' | 'FOLLOWER' | 'PREMIUM',
    accessLevel,
  )

  return (
    <Link href={`/@${handle}/kits/${kit.slug}`} className={`overflow-hidden rounded-[1.5rem] border ${cardClassName} group`}>
      <div className="relative aspect-video bg-white/5">
        {kit.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={kit.coverImageUrl} alt={kit.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl">🗺</div>
        )}
        {kit.accessTier !== 'FREE' && (
          <AccessBadge
            label={kit.accessTier === 'FOLLOWER' ? '🔓 Follow' : '⭐ Premium'}
            className="absolute right-2 top-2"
          />
        )}
        {accessReason && (
          <AccessBadge
            label={accessReason}
            tone="reason"
            className="absolute left-2 top-2 text-[11px]"
          />
        )}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white group-hover:text-white/80">{kit.title}</h3>
        <div className="mt-2 flex items-center gap-3 text-xs text-white/40">
          {kit.primaryCity && <span>{kit.primaryCity}</span>}
          {kit.durationDays && <span>{kit.durationDays}d</span>}
          {kit.estimatedBudgetLow && <span>from ${kit.estimatedBudgetLow.toLocaleString()}</span>}
        </div>
      </div>
    </Link>
  )
}
