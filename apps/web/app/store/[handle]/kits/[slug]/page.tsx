import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import SaveKitButton from '@/components/SaveKitButton'
import { getStorefrontTheme } from '@/lib/storefrontThemes'

export async function generateMetadata({ params }: { params: { handle: string; slug: string } }) {
  const kit = await prisma.tripKit.findFirst({
    where: { slug: params.slug, creator: { handle: params.handle } },
    select: { title: true, description: true, coverImageUrl: true },
  })
  if (!kit) return {}
  return {
    title: `${kit.title} - VlogShopper`,
    description: kit.description ?? kit.title,
    openGraph: { title: kit.title, description: kit.description ?? '', images: kit.coverImageUrl ? [kit.coverImageUrl] : [] },
  }
}

export default async function KitDetailPage({ params }: { params: { handle: string; slug: string } }) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublished: true,
      storefrontTheme: true,
    },
  })
  if (!creator) notFound()

  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const viewerIsCreator = user
    ? !!(await prisma.creator.findUnique({ where: { userId: user.id, id: creator.id }, select: { id: true } }))
    : false

  if (!creator.isPublished && !viewerIsCreator) notFound()

  const kit = await prisma.tripKit.findFirst({
    where: { slug: params.slug, creatorId: creator.id, ...(viewerIsCreator ? {} : { isPublished: true }) },
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

  let hasAccess = kit.accessTier === 'FREE' || viewerIsCreator
  let subscriber: { id: string } | null = null
  let isSaved = false

  if (user) {
    subscriber = await prisma.subscriber.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })

    if (subscriber) {
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

      const saved = await prisma.savedKit.findUnique({
        where: { subscriberId_tripKitId: { subscriberId: subscriber.id, tripKitId: kit.id } },
        select: { id: true },
      })
      isSaved = !!saved
    }
  }

  void prisma.tripKit.update({ where: { id: kit.id }, data: { viewCount: { increment: 1 } } }).catch(() => {})

  const previewDays = hasAccess ? kit.days : kit.days.slice(0, 1)
  const isDraftPreview = viewerIsCreator && (!creator.isPublished || !kit.isPublished)
  const theme = getStorefrontTheme(creator.storefrontTheme)

  return (
    <div
      className="storefront-shell mx-auto max-w-4xl px-6 py-12"
      style={{ ...theme.cssVars, backgroundImage: `var(--storefront-page-bg), url(${theme.storefrontBackdropImageUrl})` }}
    >
      {isDraftPreview && (
        <div className="storefront-surface mb-6 flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
          <p className="storefront-subtle text-sm">
            {!kit.isPublished ? 'Draft preview - only you can see this kit.' : 'Your storefront is unpublished - only you can preview it.'}
          </p>
          <a href="/dashboard/kits" className="storefront-heading shrink-0 text-xs underline underline-offset-2">
            Manage kits -&gt;
          </a>
        </div>
      )}

      <div className="mb-8">
        <Link href={`/@${creator.handle}/kits`} className="storefront-muted mb-4 inline-block text-sm hover:text-[var(--storefront-text)]">
          &larr; All kits
        </Link>

        {kit.coverImageUrl && (
          <div className="mb-6 aspect-video overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={kit.coverImageUrl} alt={kit.title} className="h-full w-full object-cover" />
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="storefront-heading text-3xl font-bold">{kit.title}</h1>
            {kit.description && <p className="storefront-subtle mt-2 leading-relaxed">{kit.description}</p>}
            <div className="storefront-muted mt-3 flex flex-wrap items-center gap-3 text-sm">
              {kit.primaryCity && <span>{kit.primaryCity}</span>}
              {kit.durationDays && <span>{kit.durationDays} days</span>}
              {kit.estimatedBudgetLow && kit.estimatedBudgetHigh && (
                <span>${kit.estimatedBudgetLow.toLocaleString()}-${kit.estimatedBudgetHigh.toLocaleString()} per person</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SaveKitButton
              kitId={kit.id}
              initialSaved={isSaved}
              isLoggedIn={!!user}
              creatorHandle={creator.handle}
            />
            {!hasAccess && (
              <span className="storefront-chip rounded-full px-2 py-1 text-xs">
                {kit.accessTier === 'FOLLOWER' ? 'Follow to unlock' : 'Premium'}
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 border-t pt-6" style={{ borderColor: 'var(--storefront-border)' }}>
          {creator.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="storefront-surface storefront-heading flex h-10 w-10 items-center justify-center rounded-full border text-sm">
              {creator.displayName[0]}
            </div>
          )}
          <div>
            <Link href={`/@${creator.handle}`} className="storefront-heading text-sm font-medium hover:opacity-80">
              {creator.displayName}
            </Link>
            <p className="storefront-muted text-xs">@{creator.handle}</p>
          </div>
          <Link href={`/@${creator.handle}/subscribe`} className="ml-auto btn-ghost px-4 py-1.5 text-sm">
            Follow
          </Link>
        </div>
      </div>

      {!hasAccess && (
        <div className="storefront-card mb-8 p-8 text-center">
          <h2 className="storefront-heading mb-2 text-lg font-semibold">
            {kit.accessTier === 'FOLLOWER' ? 'Follow to unlock this kit' : 'Subscribe to unlock this kit'}
          </h2>
          <p className="storefront-muted mb-6 text-sm">
            {kit.accessTier === 'FOLLOWER'
              ? `Follow ${creator.displayName} for free to access all follower-tier kits.`
              : `Subscribe to ${creator.displayName} to unlock premium kits and exclusive content.`}
          </p>
          <Link href={`/@${creator.handle}/subscribe`} className="btn-primary">
            {kit.accessTier === 'FOLLOWER' ? 'Follow for free' : 'See subscription options'}
          </Link>
        </div>
      )}

      {previewDays.length > 0 && (
        <div className="space-y-6">
          <h2 className="storefront-heading text-xl font-bold">Itinerary</h2>

          {previewDays.map((day) => (
            <div key={day.id} className="storefront-card overflow-hidden">
              <div className="border-b p-5" style={{ borderColor: 'var(--storefront-border)' }}>
                <h3 className="storefront-heading font-semibold">{day.title}</h3>
                {day.summary && <p className="storefront-muted mt-1 text-sm">{day.summary}</p>}
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--storefront-border)' }}>
                {day.activities.map((activity) => (
                  <div key={activity.id} className="flex gap-4 p-5">
                    <div className="storefront-muted w-16 shrink-0 pt-0.5 text-xs">{activity.time ?? '-'}</div>
                    <div className="flex-1">
                      <p className="storefront-heading text-sm font-medium">{activity.title}</p>
                      {activity.description && <p className="storefront-muted mt-1 text-xs leading-relaxed">{activity.description}</p>}
                      {activity.affiliateLink && (
                        <a
                          href={`/r/r/${activity.affiliateLink.shortCode}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:opacity-80"
                          style={{ borderColor: 'var(--storefront-border)', color: 'var(--storefront-subtle)' }}
                        >
                          {activity.affiliateLink.priceFrom && <span>{activity.affiliateLink.priceFrom}</span>}
                          Book on {activity.affiliateLink.provider.replace(/_/g, ' ')} -&gt;
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {day.activities.length === 0 && (
                  <div className="storefront-muted p-5 text-center text-sm">No activities planned for this day yet.</div>
                )}
              </div>
              {day.tips.length > 0 && (
                <div className="px-5 pb-5">
                  <p className="storefront-muted mb-2 text-xs font-medium uppercase tracking-wider">Tips</p>
                  <ul className="space-y-1">
                    {day.tips.map((tip, i) => (
                      <li key={i} className="storefront-muted text-xs">
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {!hasAccess && kit.days.length > 1 && (
            <div className="relative">
              <div className="pointer-events-none select-none opacity-20">
                {kit.days.slice(1, 3).map((day) => (
                  <div key={day.id} className="storefront-card mb-4 p-5">
                    <h3 className="storefront-heading font-semibold">{day.title}</h3>
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="storefront-subtle mb-3 text-sm">{kit.days.length - 1} more days inside</p>
                  <Link href={`/@${creator.handle}/subscribe`} className="btn-primary text-sm">
                    Unlock full itinerary
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {kit.sourceVlogs.length > 0 && hasAccess && (
        <div className="mt-10">
          <h2 className="storefront-heading mb-4 text-xl font-bold">Watch the Vlog</h2>
          <div className="space-y-3">
            {kit.sourceVlogs.map((sv) => (
              <div key={sv.vlogId} className="storefront-card flex items-center gap-3 p-4">
                <span className="storefront-heading text-lg">{sv.vlog.platform === 'YOUTUBE' ? 'Video' : 'Clip'}</span>
                <div className="min-w-0 flex-1">
                  <p className="storefront-heading truncate text-sm">{sv.vlog.title}</p>
                  <p className="storefront-muted text-xs">{sv.vlog.platform}</p>
                </div>
                <a href={sv.vlog.externalUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-1.5 text-xs">
                  Watch -&gt;
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
