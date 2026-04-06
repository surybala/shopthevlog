import Link from 'next/link'
import prisma from '@/lib/prisma/client'

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

  const kits = await prisma.tripKit.findMany({
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
    orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
    take: 48,
    include: {
      creator: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
    select: {
      id: true, title: true, slug: true, coverImageUrl: true, primaryCity: true, countries: true,
      durationDays: true, accessTier: true, viewCount: true, saveCount: true,
      estimatedBudgetLow: true, estimatedBudgetHigh: true, travelStyle: true, description: true,
      creator: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
  })

  const trending = await prisma.tripKit.findMany({
    where: { isPublished: true, creator: { isPublished: true } },
    orderBy: { viewCount: 'desc' },
    take: 6,
    select: {
      id: true, title: true, slug: true, coverImageUrl: true, primaryCity: true, countries: true,
      durationDays: true, accessTier: true, viewCount: true,
      creator: { select: { handle: true, displayName: true } },
    },
  })

  const popularCountries = await prisma.tripKit.findMany({
    where: { isPublished: true, creator: { isPublished: true } },
    select: { countries: true },
    take: 200,
  }).then(kits => {
    const counts: Record<string, number> = {}
    kits.forEach(k => k.countries.forEach(c => { counts[c] = (counts[c] ?? 0) + 1 }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c)
  })

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 bg-black/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold">VlogShopper</Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-white/50 hover:text-white">Sign in</Link>
            <Link href="/signup" className="btn-primary text-sm py-1.5 px-4">Start free</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header + search */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-3">Discover Trip Kits</h1>
          <p className="text-white/50 max-w-lg mx-auto mb-8">Shoppable travel itineraries from your favorite creators</p>

          <form className="max-w-lg mx-auto flex gap-2" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search destinations, kits, creators…"
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-5 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <button type="submit" className="btn-primary text-sm">Search</button>
          </form>
        </div>

        {/* Country filters */}
        {popularCountries.length > 0 && !q && (
          <div className="flex flex-wrap gap-2 mb-10 justify-center">
            <Link
              href="/discover"
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                !country ? 'bg-white text-black border-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
              }`}
            >
              All
            </Link>
            {popularCountries.map(c => (
              <Link
                key={c}
                href={`/discover?country=${encodeURIComponent(c)}`}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  country === c ? 'bg-white text-black border-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
                }`}
              >
                {c}
              </Link>
            ))}
          </div>
        )}

        {/* Trending (shown when no search) */}
        {!q && !country && trending.length > 0 && (
          <section className="mb-14">
            <h2 className="text-xl font-bold text-white mb-5">🔥 Trending This Week</h2>
            <div className="grid grid-cols-3 gap-4">
              {trending.map(kit => (
                <Link key={kit.id} href={`/@${kit.creator.handle}/kits/${kit.slug}`} className="glass-card overflow-hidden group flex gap-4 p-4">
                  <div className="w-16 h-16 rounded-xl bg-white/5 shrink-0 overflow-hidden">
                    {kit.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={kit.coverImageUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">🗺</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{kit.title}</p>
                    <p className="text-xs text-white/40 mt-0.5">{kit.primaryCity ?? kit.countries[0]}</p>
                    <p className="text-xs text-white/30 mt-1">by {kit.creator.displayName}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Search results / all kits */}
        <section>
          <h2 className="text-xl font-bold text-white mb-5">
            {q ? `Results for "${q}"` : country ? country : 'All Trip Kits'}
            <span className="text-sm font-normal text-white/30 ml-3">{kits.length} kits</span>
          </h2>

          {kits.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-white/40">No kits found{q ? ` for "${q}"` : ''}.</p>
              {q && <Link href="/discover" className="text-sm text-white/60 hover:text-white mt-2 inline-block">Clear search</Link>}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {kits.map(kit => (
                <Link key={kit.id} href={`/@${kit.creator.handle}/kits/${kit.slug}`} className="glass-card overflow-hidden group">
                  <div className="aspect-video bg-white/5 relative overflow-hidden">
                    {kit.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={kit.coverImageUrl} alt={kit.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">🗺</div>
                    )}
                    {kit.accessTier !== 'FREE' && (
                      <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full bg-black/60 text-white/60">
                        {kit.accessTier === 'FOLLOWER' ? 'Follow' : '⭐'}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-semibold text-white line-clamp-2 leading-snug">{kit.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {kit.creator.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kit.creator.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
                      ) : null}
                      <p className="text-xs text-white/40 truncate">{kit.creator.displayName}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-white/30">
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
