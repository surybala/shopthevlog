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

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Trip Kits — ${creator?.displayName ?? params.handle} — VlogShopper` }
}

export default async function StorefrontKitsPage({ params }: { params: { handle: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    include: {
      tripKits: {
        where: { isPublished: true },
        orderBy: tripKitRankingOrder,
        select: {
          id: true, title: true, slug: true, coverImageUrl: true, primaryCity: true, countries: true,
          cities: true, durationDays: true, accessTier: true, isFeatured: true, viewCount: true,
          saveCount: true, estimatedBudgetLow: true, estimatedBudgetHigh: true, travelStyle: true,
          description: true, generatedByAI: true,
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

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10">
        <Link href={`/@${creator.handle}`} className="text-sm text-white/40 hover:text-white mb-4 inline-block">← {creator.displayName}</Link>
        <h1 className="text-3xl font-bold text-white">All Trip Kits</h1>
        <p className="text-white/40 mt-1">{rankedTripKits.length} kits by {creator.displayName}</p>
      </div>

      {rankedTripKits.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-white/30">No kits published yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {rankedTripKits.map(kit => (
            <Link key={kit.id} href={`/@${creator.handle}/kits/${kit.slug}`} className="glass-card overflow-hidden group">
              <div className="aspect-video bg-white/5 relative overflow-hidden">
                {kit.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kit.coverImageUrl} alt={kit.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl">🗺</div>
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  {kit.isFeatured && <span className="text-xs px-2 py-0.5 rounded-full bg-black/60 text-yellow-400">Featured</span>}
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
                  {kit.generatedByAI && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/60 text-white">AI</span>}
                </div>
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-white group-hover:text-white/80 line-clamp-2 leading-snug">{kit.title}</h3>
                {kit.description && <p className="text-white/40 text-sm mt-1.5 line-clamp-2">{kit.description}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-white/40">
                  {kit.countries.map(c => <span key={c} className="bg-white/5 px-2 py-0.5 rounded">{c}</span>)}
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
