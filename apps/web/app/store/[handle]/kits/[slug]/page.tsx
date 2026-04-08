import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import SaveKitButton from '@/components/SaveKitButton'

export async function generateMetadata({ params }: { params: { handle: string; slug: string } }) {
  const kit = await prisma.tripKit.findFirst({
    where: { slug: params.slug, creator: { handle: params.handle } },
    select: { title: true, description: true, coverImageUrl: true },
  })
  if (!kit) return {}
  return {
    title: `${kit.title} — VlogShopper`,
    description: kit.description ?? kit.title,
    openGraph: { title: kit.title, description: kit.description ?? '', images: kit.coverImageUrl ? [kit.coverImageUrl] : [] },
  }
}

export default async function KitDetailPage({ params }: { params: { handle: string; slug: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { id: true, handle: true, displayName: true, avatarUrl: true, isPublished: true } })
  if (!creator || !creator.isPublished) notFound()

  const kit = await prisma.tripKit.findFirst({
    where: { slug: params.slug, creatorId: creator.id, isPublished: true },
    include: {
      days: {
        orderBy: { dayNumber: 'asc' },
        include: {
          activities: {
            orderBy: { sortOrder: 'asc' },
            include: { affiliateLink: true },
          },
        },
      },
      sections: { orderBy: { sortOrder: 'asc' } },
      sourceVlogs: { include: { vlog: { select: { title: true, externalUrl: true, platform: true, externalId: true } } } },
    },
  })

  if (!kit) notFound()

  // Always fetch auth state — needed for both access gating and save state
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  let hasAccess = kit.accessTier === 'FREE'
  let subscriber: { id: string } | null = null
  let isSaved = false

  if (user) {
    subscriber = await prisma.subscriber.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })

    if (subscriber) {
      // Check access for gated kits
      if (!hasAccess) {
        const sub = await prisma.subscription.findFirst({
          where: { subscriberId: subscriber.id, creatorId: creator.id, status: 'ACTIVE' },
          include: { tier: true },
        })
        if (sub) {
          hasAccess = kit.accessTier === 'FOLLOWER' || sub.tier.kitAccess === 'PREMIUM'
        } else {
          const follow = await prisma.follow.findUnique({
            where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
          })
          hasAccess = kit.accessTier === 'FOLLOWER' && !!follow
        }
      }

      // Check saved state
      const saved = await prisma.savedKit.findUnique({
        where: { subscriberId_kitId: { subscriberId: subscriber.id, kitId: kit.id } },
        select: { id: true },
      })
      isSaved = !!saved
    }
  }

  // Increment view count (fire-and-forget, best effort)
  void prisma.tripKit.update({ where: { id: kit.id }, data: { viewCount: { increment: 1 } } }).catch(() => {})

  const previewDays = hasAccess ? kit.days : kit.days.slice(0, 1)

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <Link href={`/@${creator.handle}/kits`} className="text-sm text-white/40 hover:text-white mb-4 inline-block">← All kits</Link>

        {kit.coverImageUrl && (
          <div className="aspect-video rounded-2xl overflow-hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={kit.coverImageUrl} alt={kit.title} className="w-full h-full object-cover" />
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{kit.title}</h1>
            {kit.description && <p className="text-white/60 mt-2 leading-relaxed">{kit.description}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-white/40">
              {kit.primaryCity && <span>📍 {kit.primaryCity}</span>}
              {kit.durationDays && <span>📅 {kit.durationDays} days</span>}
              {kit.estimatedBudgetLow && kit.estimatedBudgetHigh && (
                <span>💰 ${kit.estimatedBudgetLow.toLocaleString()}–${kit.estimatedBudgetHigh.toLocaleString()} per person</span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <SaveKitButton
              kitId={kit.id}
              initialSaved={isSaved}
              isLoggedIn={!!user}
              creatorHandle={creator.handle}
            />
            {!hasAccess && (
              <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/50">
                {kit.accessTier === 'FOLLOWER' ? '🔓 Follow to unlock' : '⭐ Premium'}
              </span>
            )}
          </div>
        </div>

        {/* Creator card */}
        <div className="flex items-center gap-3 mt-6 pt-6 border-t border-white/10">
          {creator.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm">{creator.displayName[0]}</div>
          )}
          <div>
            <Link href={`/@${creator.handle}`} className="text-sm font-medium text-white hover:text-white/70">{creator.displayName}</Link>
            <p className="text-xs text-white/40">@{creator.handle}</p>
          </div>
          <Link href={`/@${creator.handle}/subscribe`} className="ml-auto text-sm btn-ghost py-1.5 px-4">Follow</Link>
        </div>
      </div>

      {/* Paywall */}
      {!hasAccess && (
        <div className="glass-card p-8 mb-8 text-center">
          <p className="text-2xl mb-3">{kit.accessTier === 'FOLLOWER' ? '🔓' : '⭐'}</p>
          <h2 className="text-lg font-semibold text-white mb-2">
            {kit.accessTier === 'FOLLOWER' ? 'Follow to unlock this kit' : 'Subscribe to unlock this kit'}
          </h2>
          <p className="text-white/40 text-sm mb-6">
            {kit.accessTier === 'FOLLOWER'
              ? `Follow ${creator.displayName} for free to access all follower-tier kits.`
              : `Subscribe to ${creator.displayName} to unlock premium kits and exclusive content.`}
          </p>
          <Link href={`/@${creator.handle}/subscribe`} className="btn-primary">
            {kit.accessTier === 'FOLLOWER' ? 'Follow for free' : 'See subscription options'}
          </Link>
        </div>
      )}

      {/* Itinerary */}
      {previewDays.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-white">Itinerary</h2>

          {previewDays.map(day => (
            <div key={day.id} className="glass-card overflow-hidden">
              <div className="p-5 border-b border-white/10">
                <h3 className="font-semibold text-white">{day.title}</h3>
                {day.summary && <p className="text-white/40 text-sm mt-1">{day.summary}</p>}
              </div>
              <div className="divide-y divide-white/10">
                {day.activities.map(activity => (
                  <div key={activity.id} className="p-5 flex gap-4">
                    <div className="shrink-0 text-xs text-white/30 w-16 pt-0.5">{activity.time ?? '—'}</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{activity.title}</p>
                      {activity.description && <p className="text-xs text-white/50 mt-1 leading-relaxed">{activity.description}</p>}
                      {activity.affiliateLink && (
                        <a
                          href={`/r/r/${activity.affiliateLink.shortCode}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2 text-xs text-white/70 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/30 transition-colors"
                        >
                          {activity.affiliateLink.priceFrom && <span>{activity.affiliateLink.priceFrom}</span>}
                          Book on {activity.affiliateLink.provider.replace(/_/g, ' ')} ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {day.activities.length === 0 && (
                  <div className="p-5 text-white/30 text-sm text-center">No activities planned for this day yet.</div>
                )}
              </div>
              {day.tips.length > 0 && (
                <div className="px-5 pb-5">
                  <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Tips</p>
                  <ul className="space-y-1">
                    {day.tips.map((tip, i) => <li key={i} className="text-xs text-white/50">💡 {tip}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {/* Blurred remaining days if no access */}
          {!hasAccess && kit.days.length > 1 && (
            <div className="relative">
              <div className="opacity-20 pointer-events-none select-none">
                {kit.days.slice(1, 3).map(day => (
                  <div key={day.id} className="glass-card mb-4 p-5">
                    <h3 className="font-semibold text-white">{day.title}</h3>
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-white/60 text-sm mb-3">{kit.days.length - 1} more days inside</p>
                  <Link href={`/@${creator.handle}/subscribe`} className="btn-primary text-sm">Unlock full itinerary</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source vlogs */}
      {kit.sourceVlogs.length > 0 && hasAccess && (
        <div className="mt-10">
          <h2 className="text-xl font-bold text-white mb-4">Watch the Vlog</h2>
          <div className="space-y-3">
            {kit.sourceVlogs.map(sv => (
              <div key={sv.vlogId} className="glass-card p-4 flex items-center gap-3">
                <span className="text-lg">{sv.vlog.platform === 'YOUTUBE' ? '▶' : '♪'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{sv.vlog.title}</p>
                  <p className="text-xs text-white/40">{sv.vlog.platform}</p>
                </div>
                <a href={sv.vlog.externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs btn-ghost py-1.5 px-3">Watch ↗</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
