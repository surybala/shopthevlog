import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getTripKitAccessReasonLabel, rankSavedKitsForViewer } from '@/lib/ranking'
import { buildViewerCreatorAccessMapFromRelationships } from '@/lib/viewerAccess'
import AccessBadge from '@/components/AccessBadge'
import UnfollowButton from './UnfollowButton'
import UnsaveButton from './UnsaveButton'

export const metadata = { title: 'My Account — VlogShopper' }

type Tab = 'following' | 'subscriptions' | 'saved'

const TABS: { key: Tab; label: string }[] = [
  { key: 'following',     label: 'Following'      },
  { key: 'subscriptions', label: 'Subscriptions'  },
  { key: 'saved',         label: 'Saved Kits'     },
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
    : searchParams.tab === 'saved'       ? 'saved'
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

  // Run all three queries in parallel — they're all cheap and always needed for counts
  const [following, subscriptions, savedKits] = await Promise.all([
    subscriber
      ? prisma.follow.findMany({
          where: { subscriberId: subscriber.id },
          orderBy: { followedAt: 'desc' },
          include: {
            creator: {
              select: {
                handle: true, displayName: true, avatarUrl: true,
                bio: true, subscriberCount: true, isPublished: true,
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
            tier:    { select: { name: true, monthlyPrice: true, perks: true } },
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
                id: true, creatorId: true, title: true, slug: true, coverImageUrl: true,
                primaryCity: true, countries: true, durationDays: true,
                accessTier: true, estimatedBudgetLow: true,
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
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 bg-black/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-white">VlogShopper</Link>
          <div className="flex items-center gap-4">
            <Link href="/discover" className="text-sm text-white/50 hover:text-white">Discover</Link>
            {creator && (
              <Link href="/dashboard" className="text-sm px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors">
                Creator Dashboard ↗
              </Link>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{displayName}</h1>
          <p className="text-sm text-white/40 mt-1">{user.email}</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-white/10 mb-8">
          {TABS.map(t => {
            const count =
              t.key === 'following'     ? following.length
              : t.key === 'subscriptions' ? subscriptions.length
              : savedKits.length
            return (
              <Link
                key={t.key}
                href={`/account?tab=${t.key}`}
                className={`px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                  tab === t.key
                    ? 'text-white border-b-2 border-white -mb-px'
                    : 'text-white/40 hover:text-white'
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* ── Following ──────────────────────────────────────────────────────── */}
        {tab === 'following' && (
          <div>
            {following.length === 0 ? (
              <EmptyState
                icon="👥"
                title="Not following anyone yet"
                body="Follow creators to see their latest Trip Kits here."
                cta="Discover creators"
                href="/discover"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {following.map(f => (
                  <div key={f.id} className="glass-card p-5 flex items-start gap-4">
                    {f.creator.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.creator.avatarUrl}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg shrink-0">
                        {f.creator.displayName[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/@${f.creator.handle}`}
                        className="font-semibold text-white hover:text-white/70 transition-colors"
                      >
                        {f.creator.displayName}
                      </Link>
                      <p className="text-xs text-white/40 mt-0.5">@{f.creator.handle}</p>
                      {f.creator.bio && (
                        <p className="text-xs text-white/50 mt-1.5 line-clamp-2">{f.creator.bio}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
                        <span>{f.creator._count.tripKits} kits</span>
                        <span>·</span>
                        <span>followed {new Date(f.followedAt).toLocaleDateString()}</span>
                      </div>
                      {viewerAccessByCreatorId[f.creatorId] === 'PREMIUM' && (
                        <AccessBadge label="Premium access active" tone="status" className="mt-2 text-[11px]" />
                      )}
                    </div>
                    <UnfollowButton creatorHandle={f.creator.handle} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Subscriptions ──────────────────────────────────────────────────── */}
        {tab === 'subscriptions' && (
          <div>
            {subscriptions.length === 0 ? (
              <EmptyState
                icon="⭐"
                title="No active subscriptions"
                body="Subscribe to creators to unlock premium Trip Kits and exclusive content."
                cta="Discover creators"
                href="/discover"
              />
            ) : (
              <div className="space-y-4">
                {subscriptions.map(sub => (
                  <div key={sub.id} className="glass-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {sub.creator.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sub.creator.avatarUrl}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm">
                            {sub.creator.displayName[0]}
                          </div>
                        )}
                        <div>
                          <Link
                            href={`/@${sub.creator.handle}`}
                            className="font-semibold text-white hover:text-white/70"
                          >
                            {sub.creator.displayName}
                          </Link>
                          <p className="text-xs text-white/40 mt-0.5">{sub.tier.name}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-white">
                          ${(sub.tier.monthlyPrice / 100).toFixed(2)}/mo
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                          sub.status === 'ACTIVE'   ? 'bg-green-500/20 text-green-400'
                          : sub.status === 'TRIALING' ? 'bg-blue-500/20 text-blue-400'
                          : sub.status === 'PAST_DUE' ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-white/10 text-white/40'
                        }`}>
                          {sub.status === 'ACTIVE'    ? 'Active'
                           : sub.status === 'TRIALING'  ? 'Trial'
                           : sub.status === 'PAST_DUE'  ? 'Past due'
                           : sub.status === 'CANCELED'  ? 'Canceled'
                           : sub.status}
                        </span>
                      </div>
                    </div>

                    {sub.tier.perks.length > 0 && (
                      <ul className="mt-4 space-y-1">
                        {sub.tier.perks.slice(0, 3).map((perk, i) => (
                          <li key={i} className="text-xs text-white/50">✓ {perk}</li>
                        ))}
                        {sub.tier.perks.length > 3 && (
                          <li className="text-xs text-white/30">+{sub.tier.perks.length - 3} more</li>
                        )}
                      </ul>
                    )}

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
                      <p className="text-xs text-white/30">
                        {sub.cancelAtPeriodEnd
                          ? `Cancels ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
                          : `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
                      </p>
                      <Link
                        href={`/@${sub.creator.handle}`}
                        className="text-xs text-white/50 hover:text-white transition-colors"
                      >
                        Browse kits →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Saved Kits ─────────────────────────────────────────────────────── */}
        {tab === 'saved' && (
          <div>
            {rankedSavedKits.length === 0 ? (
              <EmptyState
                icon="🗺"
                title="No saved kits yet"
                body="Save Trip Kits to build your travel wishlist."
                cta="Browse kits"
                href="/discover"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rankedSavedKits.map(s => {
                  const kit = s.tripKit
                  const accessReason = getTripKitAccessReasonLabel(
                    kit.accessTier,
                    viewerAccessByCreatorId[kit.creatorId] ?? 'FREE',
                  )
                  return (
                    <div key={kit.id} className="glass-card overflow-hidden group relative">
                      <div className="aspect-video bg-white/5 overflow-hidden">
                        {kit.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={kit.coverImageUrl}
                            alt={kit.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-4xl">🗺</div>
                        )}
                        {kit.accessTier !== 'FREE' && (
                          <AccessBadge
                            label={kit.accessTier === 'FOLLOWER' ? 'Follow' : '⭐'}
                            className="absolute top-2 left-2 px-1.5 text-white/60"
                          />
                        )}
                        {accessReason && (
                          <AccessBadge
                            label={accessReason}
                            tone="reason"
                            className="absolute top-2 right-2 text-[11px]"
                          />
                        )}
                      </div>
                      <div className="p-4">
                        <Link
                          href={`/@${kit.creator.handle}/kits/${kit.slug}`}
                          className="font-semibold text-sm text-white line-clamp-2 leading-snug hover:text-white/70"
                        >
                          {kit.title}
                        </Link>
                        <p className="text-xs text-white/40 mt-1">{kit.creator.displayName}</p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-2 text-xs text-white/30">
                            {kit.primaryCity && <span>{kit.primaryCity}</span>}
                            {kit.durationDays && <span>· {kit.durationDays}d</span>}
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
        )}
      </div>
    </div>
  )
}

function EmptyState({
  icon, title, body, cta, href,
}: {
  icon: string; title: string; body: string; cta: string; href: string
}) {
  return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">{icon}</p>
      <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
      <p className="text-sm text-white/40 mb-6 max-w-sm mx-auto">{body}</p>
      <Link href={href} className="btn-primary text-sm">{cta}</Link>
    </div>
  )
}
