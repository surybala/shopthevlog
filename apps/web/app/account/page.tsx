import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getTripKitAccessReasonLabel, rankSavedKitsForViewer } from '@/lib/ranking'
import { buildViewerCreatorAccessMapFromRelationships } from '@/lib/viewerAccess'
import AccessBadge from '@/components/AccessBadge'
import UnfollowButton from './UnfollowButton'
import UnsaveButton from './UnsaveButton'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'
import { getTripKitCardImageUrl } from '@/lib/tripKitImages'

export const metadata = { title: 'My Account - VlogShopper' }

type Tab = 'following' | 'subscriptions' | 'saved'

const TABS: { key: Tab; label: string }[] = [
  { key: 'following', label: 'Following' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'saved', label: 'Saved Kits' },
]

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/account')

  const tab: Tab =
    searchParams.tab === 'subscriptions' ? 'subscriptions'
      : searchParams.tab === 'saved' ? 'saved'
        : 'following'

  const [subscriber, creator] = await Promise.all([
    prisma.subscriber.findUnique({
      where: { userId: user.id },
      select: { id: true, displayName: true },
    }),
    prisma.creator.findUnique({
      where: { userId: user.id },
      select: { handle: true, displayName: true },
    }),
  ])

  const [following, subscriptions, savedKits] = await Promise.all([
    subscriber
      ? prisma.follow.findMany({
          where: { subscriberId: subscriber.id },
          orderBy: { followedAt: 'desc' },
          include: {
            creator: {
              select: {
                handle: true,
                displayName: true,
                avatarUrl: true,
                bio: true,
                subscriberCount: true,
                isPublished: true,
                _count: { select: { tripKits: { where: { isPublished: true } } } },
              },
            },
          },
        })
      : [],
    subscriber
      ? prisma.subscription.findMany({
          where: { subscriberId: subscriber.id },
          orderBy: { createdAt: 'desc' },
          include: {
            tier: { select: { name: true, monthlyPrice: true, perks: true, kitAccess: true } },
            creator: { select: { handle: true, displayName: true, avatarUrl: true } },
          },
        })
      : [],
    subscriber
      ? prisma.savedKit.findMany({
          where: { subscriberId: subscriber.id },
          orderBy: { savedAt: 'desc' },
          take: 50,
          include: {
            tripKit: {
              select: {
                id: true,
                creatorId: true,
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
                durationDays: true,
                accessTier: true,
                estimatedBudgetLow: true,
                creator: { select: { handle: true, displayName: true } },
              },
            },
          },
        })
      : [],
  ])

  const viewerAccessByCreatorId = buildViewerCreatorAccessMapFromRelationships({
    followedCreatorIds: following.map((follow) => follow.creatorId),
    premiumCreatorIds: subscriptions
      .filter((subscription) => subscription.tier.kitAccess === 'PREMIUM')
      .map((subscription) => subscription.creatorId),
  })
  const rankedSavedKits = rankSavedKitsForViewer(savedKits, viewerAccessByCreatorId)

  const displayName = subscriber?.displayName ?? user.email?.split('@')[0] ?? 'Traveler'

  return (
    <div className="editorial-shell min-h-screen text-[#17332d]">
      <nav className="sticky top-0 z-50 border-b border-[#17332d]/10 bg-[rgba(255,248,240,0.82)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-bold text-[#17332d]">VlogShopper</Link>
          <div className="flex items-center gap-4">
            <Link href="/discover" className="dashboard-mirror-subtle text-sm hover:text-[#17332d]">Discover</Link>
            {creator ? (
              <Link href="/dashboard" className="rounded-full bg-[#17332d]/8 px-3 py-1.5 text-sm text-[#17332d] transition-colors hover:bg-[#17332d]/12">
                Creator Dashboard {'->'}
              </Link>
            ) : null}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="dashboard-mirror-panel mb-8 p-6">
          <p className="dashboard-mirror-kicker text-xs">Subscriber account</p>
          <h1 className="mt-3 text-3xl font-bold text-[#17332d]">{displayName}</h1>
          <p className="dashboard-mirror-subtle mt-2 text-sm">{user.email}</p>
        </div>

        <div className="mb-8 flex gap-2 border-b border-[rgba(214,205,184,0.08)]">
          {TABS.map((entry) => {
            const count =
              entry.key === 'following' ? following.length
                : entry.key === 'subscriptions' ? subscriptions.length
                  : savedKits.length

            return (
              <Link
                key={entry.key}
                href={`/account?tab=${entry.key}`}
                className={`-mb-px flex items-center gap-2 rounded-t-2xl px-4 py-3 text-sm font-medium transition-colors ${
                  tab === entry.key
                    ? 'border-b-2 border-[#17332d] text-[#17332d]'
                    : 'dashboard-mirror-subtle hover:text-[#17332d]'
                }`}
              >
                {entry.label}
                {count > 0 ? (
                  <span className="rounded-full bg-[#17332d]/8 px-1.5 py-0.5 text-xs text-[#17332d]/78">
                    {count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </div>

        {tab === 'following' ? (
          <div>
            {following.length === 0 ? (
              <EmptyState
                title="Not following anyone yet"
                body="Follow creators to see their latest Trip Kits here."
                cta="Discover creators"
                href="/discover"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {following.map((follow) => (
                  <div key={follow.id} className="dashboard-mirror-card flex items-start gap-4 p-5">
                    {follow.creator.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolveStorageAssetUrl(follow.creator.avatarUrl) ?? ''} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#17332d]/10 text-lg text-[#17332d]/85">
                        {follow.creator.displayName[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <Link href={`/@${follow.creator.handle}`} className="font-semibold text-[#17332d] hover:text-[#17332d]/80">
                        {follow.creator.displayName}
                      </Link>
                      <p className="dashboard-mirror-muted mt-0.5 text-xs">@{follow.creator.handle}</p>
                      {follow.creator.bio ? (
                        <p className="dashboard-mirror-subtle mt-1.5 line-clamp-2 text-xs">{follow.creator.bio}</p>
                      ) : null}
                      <div className="dashboard-mirror-muted mt-2 flex items-center gap-3 text-xs">
                        <span>{follow.creator._count.tripKits} kits</span>
                        <span>·</span>
                        <span>followed {new Date(follow.followedAt).toLocaleDateString()}</span>
                      </div>
                      {viewerAccessByCreatorId[follow.creatorId] === 'PREMIUM' ? (
                        <AccessBadge label="Premium access active" tone="status" className="mt-2 text-[11px]" />
                      ) : null}
                    </div>
                    <UnfollowButton creatorHandle={follow.creator.handle} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'subscriptions' ? (
          <div>
            {subscriptions.length === 0 ? (
              <EmptyState
                title="No active subscriptions"
                body="Subscribe to creators to unlock premium Trip Kits and exclusive content."
                cta="Discover creators"
                href="/discover"
              />
            ) : (
              <div className="space-y-4">
                {subscriptions.map((subscription) => (
                  <div key={subscription.id} className="dashboard-mirror-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {subscription.creator.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={resolveStorageAssetUrl(subscription.creator.avatarUrl) ?? ''} alt="" className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17332d]/10 text-sm text-[#17332d]/85">
                            {subscription.creator.displayName[0]}
                          </div>
                        )}
                        <div>
                          <Link href={`/@${subscription.creator.handle}`} className="font-semibold text-[#17332d] hover:text-[#17332d]/80">
                            {subscription.creator.displayName}
                          </Link>
                          <p className="dashboard-mirror-muted mt-0.5 text-xs">{subscription.tier.name}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-[#17332d]">
                          ${(subscription.tier.monthlyPrice / 100).toFixed(2)}/mo
                        </p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                          subscription.status === 'ACTIVE' ? 'bg-green-500/20 text-green-200'
                            : subscription.status === 'TRIALING' ? 'bg-blue-500/20 text-blue-200'
                              : subscription.status === 'PAST_DUE' ? 'bg-yellow-500/20 text-yellow-100'
                                : 'bg-[#17332d]/8 text-[#17332d]/76'
                        }`}>
                          {subscription.status === 'ACTIVE' ? 'Active'
                            : subscription.status === 'TRIALING' ? 'Trial'
                              : subscription.status === 'PAST_DUE' ? 'Past due'
                                : subscription.status === 'CANCELED' ? 'Canceled'
                                  : subscription.status}
                        </span>
                      </div>
                    </div>

                    {subscription.tier.perks.length > 0 ? (
                      <ul className="mt-4 space-y-1">
                        {subscription.tier.perks.slice(0, 3).map((perk, index) => (
                          <li key={index} className="dashboard-mirror-subtle text-xs">• {perk}</li>
                        ))}
                        {subscription.tier.perks.length > 3 ? (
                          <li className="dashboard-mirror-muted text-xs">+{subscription.tier.perks.length - 3} more</li>
                        ) : null}
                      </ul>
                    ) : null}

                    <div className="mt-4 flex items-center justify-between border-t border-[rgba(214,205,184,0.08)] pt-4">
                      <p className="dashboard-mirror-muted text-xs">
                        {subscription.cancelAtPeriodEnd
                          ? `Cancels ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                          : `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                      </p>
                      <Link href={`/@${subscription.creator.handle}`} className="dashboard-mirror-subtle text-xs hover:text-[#17332d]">
                        Browse kits {'->'}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'saved' ? (
          <div>
            {rankedSavedKits.length === 0 ? (
              <EmptyState
                title="No saved kits yet"
                body="Save Trip Kits to build your travel wishlist."
                cta="Browse kits"
                href="/discover"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rankedSavedKits.map((savedKit) => {
                  const kit = savedKit.tripKit
                  const accessReason = getTripKitAccessReasonLabel(
                    kit.accessTier,
                    viewerAccessByCreatorId[kit.creatorId] ?? 'FREE',
                  )

                  return (
                    <div key={kit.id} className="dashboard-mirror-card group relative overflow-hidden">
                      <div className="aspect-video overflow-hidden bg-white/8">
                        {getTripKitCardImageUrl(kit) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getTripKitCardImageUrl(kit) ?? ''}
                            alt={kit.title}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-full w-full bg-[linear-gradient(135deg,rgba(23,51,45,0.16),rgba(210,156,92,0.24))]" />
                        )}
                        {kit.accessTier !== 'FREE' ? (
                          <AccessBadge
                            label={kit.accessTier === 'FOLLOWER' ? 'Follow' : 'Premium'}
                            className="absolute left-2 top-2 px-1.5 text-white/80"
                          />
                        ) : null}
                        {accessReason ? (
                          <AccessBadge
                            label={accessReason}
                            tone="reason"
                            className="absolute right-2 top-2 text-[11px]"
                          />
                        ) : null}
                      </div>
                      <div className="p-4">
                        <Link
                          href={`/@${kit.creator.handle}/kits/${kit.slug}`}
                          className="line-clamp-2 text-sm font-semibold leading-snug text-[#17332d] hover:text-[#17332d]/80"
                        >
                          {kit.title}
                        </Link>
                        <p className="dashboard-mirror-muted mt-1 text-xs">{kit.creator.displayName}</p>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="dashboard-mirror-muted flex items-center gap-2 text-xs">
                            {kit.primaryCity ? <span>{kit.primaryCity}</span> : null}
                            {kit.durationDays ? <span>· {kit.durationDays}d</span> : null}
                          </div>
                          <UnsaveButton kitId={kit.id} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({
  title,
  body,
  cta,
  href,
}: {
  title: string
  body: string
  cta: string
  href: string
}) {
  return (
    <div className="dashboard-mirror-card py-20 text-center">
      <h2 className="mb-2 text-lg font-semibold text-[#17332d]">{title}</h2>
      <p className="dashboard-mirror-subtle mx-auto mb-6 max-w-sm text-sm">{body}</p>
      <Link href={href} className="btn-primary text-sm">{cta}</Link>
    </div>
  )
}
