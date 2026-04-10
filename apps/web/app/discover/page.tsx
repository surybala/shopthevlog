import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import {
  getTripKitAccessReasonLabel,
  rankTripKitsForViewer,
  tripKitRankingOrder,
} from '@/lib/ranking'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getViewerCreatorAccessMap } from '@/lib/viewerAccess'
import AccessBadge from '@/components/AccessBadge'
import PublicNav from '@/components/PublicNav'

export const metadata = {
  title: 'Discover — VlogShopper',
  description: 'Explore Trip Kits from travel creators around the world',
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { q?: string; country?: string; style?: string }
}) {
  const { q, country, style } = searchParams

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  const isCreator = user
    ? !!(await prisma.creator.findUnique({ where: { userId: user.id }, select: { id: true } }))
    : false
  const viewerAccessByCreatorId = await getViewerCreatorAccessMap(user?.id)

  const rankedKits = rankTripKitsForViewer(await prisma.tripKit.findMany({
    where: {
      isPublished: true,
      creator: { isPublished: true },
      ...(q && {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { countries: { has: q } },
          { cities: { has: q } },
        ],
      }),
      ...(country && { countries: { has: country } }),
      ...(style && { travelStyle: { has: style as never } }),
    },
    orderBy: tripKitRankingOrder,
    take: 96,
    select: {
      id: true,
      title: true,
      slug: true,
      coverImageUrl: true,
      primaryCity: true,
      countries: true,
      creatorId: true,
      durationDays: true,
      accessTier: true,
      viewCount: true,
      saveCount: true,
      estimatedBudgetLow: true,
      estimatedBudgetHigh: true,
      travelStyle: true,
      description: true,
      creator: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
  }), viewerAccessByCreatorId)
  const kits = rankedKits.slice(0, 48)

  const trending = rankTripKitsForViewer(await prisma.tripKit.findMany({
    where: { isPublished: true, creator: { isPublished: true } },
    orderBy: tripKitRankingOrder,
    take: 24,
    select: {
      id: true,
      title: true,
      slug: true,
      coverImageUrl: true,
      primaryCity: true,
      countries: true,
      creatorId: true,
      durationDays: true,
      accessTier: true,
      viewCount: true,
      creator: { select: { handle: true, displayName: true } },
    },
  }), viewerAccessByCreatorId).slice(0, 6)

  const popularCountries = await prisma.tripKit.findMany({
    where: { isPublished: true, creator: { isPublished: true } },
    select: { countries: true },
    take: 200,
  }).then((allKits) => {
    const counts: Record<string, number> = {}
    allKits.forEach((kit) => kit.countries.forEach((c) => {
      counts[c] = (counts[c] ?? 0) + 1
    }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c)
  })

  const getAccessReason = (creatorId: string, accessTier: 'FREE' | 'FOLLOWER' | 'PREMIUM') =>
    getTripKitAccessReasonLabel(accessTier, viewerAccessByCreatorId[creatorId] ?? 'FREE')

  return (
    <div className="min-h-screen bg-transparent text-[#17332d]">
      <PublicNav user={user} isCreator={isCreator} />

      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-3 text-4xl font-bold text-[#17332d]">Discover Trip Kits</h1>
          <p className="mx-auto mb-8 max-w-lg text-[#17332d]/58">
            Shoppable travel itineraries from your favorite creators
          </p>

          <form className="mx-auto flex max-w-lg gap-2" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search destinations, kits, creators…"
              className="flex-1 rounded-full border border-[#17332d]/12 bg-white/70 px-5 py-2.5 text-sm text-[#17332d] placeholder-[#17332d]/32 focus:outline-none focus:border-[#17332d]/30"
            />
            <button type="submit" className="btn-primary text-sm">Search</button>
          </form>
        </div>

        {popularCountries.length > 0 && !q && (
          <div className="mb-10 flex flex-wrap justify-center gap-2">
            <Link
              href="/discover"
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                !country ? 'border-[#17332d] bg-[#17332d] text-[#fff7ef]' : 'border-[#17332d]/10 text-[#17332d]/58 hover:border-[#17332d]/30 hover:text-[#17332d]'
              }`}
            >
              All
            </Link>
            {popularCountries.map((c) => (
              <Link
                key={c}
                href={`/discover?country=${encodeURIComponent(c)}`}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  country === c ? 'border-[#17332d] bg-[#17332d] text-[#fff7ef]' : 'border-[#17332d]/10 text-[#17332d]/58 hover:border-[#17332d]/30 hover:text-[#17332d]'
                }`}
              >
                {c}
              </Link>
            ))}
          </div>
        )}

        {!q && !country && trending.length > 0 && (
          <section className="mb-14">
            <h2 className="mb-5 text-xl font-bold text-[#17332d]">Trending This Week</h2>
            <div className="grid grid-cols-3 gap-4">
              {trending.map((kit) => (
                <Link key={kit.id} href={`/@${kit.creator.handle}/kits/${kit.slug}`} className="glass-card group flex gap-4 overflow-hidden p-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/30">
                    {kit.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={kit.coverImageUrl} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl">🗺</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#17332d]">{kit.title}</p>
                    <p className="mt-0.5 text-xs text-[#17332d]/48">{kit.primaryCity ?? kit.countries[0]}</p>
                    <p className="mt-1 text-xs text-[#17332d]/34">by {kit.creator.displayName}</p>
                    {getAccessReason(kit.creatorId, kit.accessTier) && (
                      <AccessBadge
                        label={getAccessReason(kit.creatorId, kit.accessTier)!}
                        tone="reason"
                        className="mt-1 text-[11px]"
                      />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-5 text-xl font-bold text-[#17332d]">
            {q ? `Results for "${q}"` : country ? country : 'All Trip Kits'}
            <span className="ml-3 text-sm font-normal text-[#17332d]/35">{kits.length} kits</span>
          </h2>

          {kits.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[#17332d]/45">No kits found{q ? ` for "${q}"` : ''}.</p>
              {q && (
                <Link href="/discover" className="mt-2 inline-block text-sm text-[#17332d]/62 hover:text-[#17332d]">
                  Clear search
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {kits.map((kit) => (
                <Link key={kit.id} href={`/@${kit.creator.handle}/kits/${kit.slug}`} className="glass-card group overflow-hidden">
                  <div className="relative aspect-video overflow-hidden bg-white/30">
                    {kit.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={kit.coverImageUrl} alt={kit.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl">🗺</div>
                    )}
                    {kit.accessTier !== 'FREE' && (
                      <AccessBadge
                        label={kit.accessTier === 'FOLLOWER' ? 'Follow' : '⭐'}
                        className="absolute top-2 right-2 px-1.5 text-white/70"
                      />
                    )}
                    {getAccessReason(kit.creatorId, kit.accessTier) && (
                      <AccessBadge
                        label={getAccessReason(kit.creatorId, kit.accessTier)!}
                        tone="reason"
                        className="absolute top-2 left-2 text-[11px]"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#17332d]">{kit.title}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {kit.creator.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kit.creator.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                      ) : null}
                      <p className="truncate text-xs text-[#17332d]/48">{kit.creator.displayName}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-[#17332d]/35">
                      {kit.primaryCity && <span>{kit.primaryCity}</span>}
                      {kit.durationDays && <span>{kit.durationDays}d</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
