import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import PublicCopyright from '@/components/PublicCopyright'

const creatorSteps = [
  {
    eyebrow: 'Ingest',
    title: 'Plug in your vlog archive',
    body: 'Connect your channel and pull in the videos you already made. VlogShopper turns your back-catalog into a working commerce layer.',
  },
  {
    eyebrow: 'Graph',
    title: 'AI builds an evidence-backed opportunity graph',
    body: 'Transcript claims, frame analysis, visual signals, review recommendations, and creator memory all flow into one reviewable system.',
  },
  {
    eyebrow: 'Publish',
    title: 'Approve once. Your storefront updates itself.',
    body: 'Publish Trip Kits, hotel picks, food spots, and gear recommendations from one review queue instead of rebuilding each itinerary by hand.',
  },
]

const subscriberMoments = [
  'Follow a creator to unlock follower-only kits.',
  'Subscribe for premium itineraries, access badges, and saved unlocks.',
  'Shop where they stayed, what they packed, and what they actually did.',
]

const storefrontSignals = [
  'Follower unlocks',
  'Premium subscriptions',
  'Affiliate-ready trips',
  'Saved kits and repeat visits',
]

const creatorGallery = [
  {
    title: 'Island reset',
    label: 'Beach stays + boat days',
    image:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'City weekender',
    label: 'Boutique hotels + food finds',
    image:
      'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Mountain route',
    label: 'Scenic stays + gear picks',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Desert escape',
    label: 'Resorts + experience bookings',
    image:
      'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Forest cabin',
    label: 'Packing lists + hidden stops',
    image:
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Mediterranean days',
    label: 'Hotels + restaurants + guides',
    image:
      'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80',
  },
]

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="landing-orb landing-orb-a" />
      <div className="landing-orb landing-orb-b" />
      <div className="landing-orb landing-orb-c" />
      <div className="landing-grid absolute inset-0 opacity-30" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#17332d]/20 to-transparent" />
    </div>
  )
}

function NavUserPill({
  label,
  initial,
}: {
  label: string
  initial: string
}) {
  return (
    <Link
      href="/account"
      className="flex items-center gap-2 whitespace-nowrap rounded-full border border-[#17332d]/10 bg-white/65 px-3 py-1.5 transition-colors hover:border-[#17332d]/20 hover:bg-white/90"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#17332d]/10 text-xs font-semibold text-[#17332d]">
        {initial}
      </span>
      <span className="text-sm text-[#17332d]/84">{label}</span>
    </Link>
  )
}

export default async function HomePage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const creator = await prisma.creator.findUnique({
      where: { userId: user.id },
      select: { handle: true },
    })

    if (creator) redirect('/dashboard')
  }

  const accountLabel =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.email?.split('@')[0] ??
    'Account'

  const accountInitial =
    (user?.user_metadata?.display_name ??
      user?.user_metadata?.full_name ??
      user?.email ??
      '?')[0]?.toUpperCase() ?? '?'

  return (
    <main className="landing-page relative min-h-screen overflow-hidden bg-transparent text-[#17332d]">
      <AuroraBackdrop />

      <nav className="sticky top-0 z-50 border-b border-[#17332d]/10 bg-[rgba(255,248,240,0.78)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="VlogShopper" width={34} height={34} className="rounded-xl shadow-[0_0_30px_rgba(23,51,45,0.08)]" />
            <div>
              <p className="text-base font-semibold tracking-tight text-[#17332d]">VlogShopper</p>
              <p className="text-[10px] uppercase tracking-[0.32em] text-[#17332d]/35">Curated by creators for their subscribers</p>
            </div>
          </Link>

          <div className="hidden items-center gap-6 text-sm text-[#17332d]/82 md:flex">
            <Link href="/discover" className="transition-colors hover:text-[#17332d]">Discover</Link>
            <a href="#creators" className="transition-colors hover:text-[#17332d]">For creators</a>
            <a href="#subscribers" className="transition-colors hover:text-[#17332d]">For subscribers</a>
            <a href="#pipeline" className="transition-colors hover:text-[#17332d]">AI pipeline</a>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <NavUserPill label={accountLabel} initial={accountInitial} />
            ) : (
              <>
                <Link href="/login" className="hidden text-sm text-[#17332d]/65 transition-colors hover:text-[#17332d] sm:block">
                  Sign in
                </Link>
                <Link href="/waitlist" className="btn-primary px-4 py-2 text-sm">
                  Request access
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="landing-section relative mx-auto grid max-w-7xl gap-12 px-6 pb-24 pt-16 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:pt-24">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-800/12 bg-white/68 px-4 py-2 text-xs uppercase tracking-[0.22em] text-teal-800">
            <span className="h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_14px_rgba(13,148,136,0.45)]" />
            Invite-only creator beta
          </div>

          <h1 className="mt-8 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-tight text-[#17332d] sm:text-6xl lg:text-7xl">
            Turn travel vlogs into
            <span className="block bg-gradient-to-r from-[#17332d] via-teal-700 to-orange-500 bg-clip-text text-transparent">
              reviewable storefronts subscribers actually shop.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#17332d]/82 sm:text-xl">
            VlogShopper scans each video, builds an evidence-backed opportunity graph, and turns hotels,
            restaurants, routes, experiences, and travel gear into Trip Kits creators can approve and subscribers can unlock.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link href="/waitlist" className="btn-primary inline-flex items-center justify-center px-6 py-3 text-sm">
              Join the creator waitlist
            </Link>
            <Link href="/discover" className="btn-ghost inline-flex items-center justify-center px-6 py-3 text-sm">
              Explore live storefronts
            </Link>
          </div>

        </div>

        <div className="relative lg:self-start">
          <div className="landing-pipeline-rail lg:sticky lg:top-20">
          <div className="landing-pipeline-panel rounded-[2rem] border border-[#17332d]/10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.92),_rgba(255,247,238,0.84)_48%,_rgba(251,241,229,0.9)_100%)] p-6 shadow-[0_30px_120px_rgba(23,51,45,0.12)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[#17332d]/52">AI Pipeline</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#17332d]">From raw vlog to shoppable Trip Kit</h2>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {[
                'Transcript claims and scene frames become evidence rows',
                'Fusion merges transcript + visual signals into one candidate',
                'Resolution, ranking, and creator memory decide review priority',
                'Approved opportunities project into Trip Kits and storefront modules',
              ].map((step, index) => (
                <div key={step} className="flex items-center gap-4 rounded-2xl border border-[#17332d]/8 bg-white/60 px-4 py-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full bg-[#17332d]/10 text-sm font-semibold text-teal-800">
                    0{index + 1}
                  </div>
                  <p className="flex-1 text-sm leading-6 text-[#17332d]/82">{step}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[#17332d]/8 bg-white/60 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#17332d]/35">Storefront unlocks</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {storefrontSignals.map((signal) => (
                  <span key={signal} className="rounded-full border border-[#17332d]/10 bg-white/72 px-3 py-1.5 text-xs text-[#17332d]/82">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="landing-ticker mt-6 overflow-hidden rounded-full border border-[#17332d]/10 bg-white/58 py-3 backdrop-blur-sm">
            <div className="landing-ticker-track flex min-w-max gap-10 px-6 text-xs uppercase tracking-[0.3em] text-[#17332d]/58">
              {Array.from({ length: 2 }).flatMap((_, idx) =>
                ['Trip Kits', 'Evidence graph', 'Creator review', 'Premium unlocks', 'Affiliate revenue', 'Saved kits'].map((item) => (
                  <span key={`${item}-${idx}`}>{item}</span>
                ))
              )}
            </div>
          </div>
          </div>
        </div>
      </section>

      <section id="creators" className="landing-section mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-teal-800/80">For creators</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#17332d] sm:text-4xl">
              Monetize the trips you already filmed.
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-[#17332d]/62 sm:text-base">
            We are not asking creators to become travel agents. We turn existing travel content into reviewable,
            accurate commerce surfaces that feel like their brand, not a generic affiliate dump.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {creatorSteps.map((step) => (
            <article key={step.title} className="rounded-[2rem] border border-[#17332d]/10 bg-white/58 p-6 backdrop-blur-sm shadow-[0_20px_50px_rgba(23,51,45,0.08)]">
              <p className="text-xs uppercase tracking-[0.26em] text-[#17332d]/35">{step.eyebrow}</p>
              <h3 className="mt-4 text-2xl font-semibold text-[#17332d]">{step.title}</h3>
              <p className="mt-4 text-sm leading-7 text-[#17332d]/60">{step.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 overflow-hidden rounded-[2rem] border border-[#17332d]/10 bg-white/52 py-5 shadow-[0_22px_60px_rgba(23,51,45,0.08)] backdrop-blur-sm">
          <div className="landing-gallery-track flex min-w-max gap-5 px-5">
            {Array.from({ length: 2 }).flatMap((_, loopIndex) =>
              creatorGallery.map((card) => (
                <article
                  key={`${card.title}-${loopIndex}`}
                  className="landing-gallery-card group relative h-72 w-[19rem] shrink-0 overflow-hidden rounded-[1.7rem] border border-white/35"
                >
                  <img
                    src={card.image}
                    alt={`${card.title} Trip Kit preview`}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(9,28,24,0.82)] via-[rgba(9,28,24,0.22)] to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-white/72">Trip Kit preview</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">{card.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/80">{card.label}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section id="subscribers" className="landing-section border-y border-[#17332d]/8 bg-[rgba(255,248,240,0.56)] py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-teal-800/80">For subscribers</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#17332d] sm:text-4xl">
              Subscribers don't just watch the trip. They can unlock it.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#17332d]/62 sm:text-base">
              Discover storefronts, save kits, follow creators, and subscribe when you want the full itinerary.
              The experience is built around trust: real places, real products, real evidence from the videos people already love.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {subscriberMoments.map((moment, index) => (
              <div key={moment} className="rounded-[1.75rem] border border-[#17332d]/10 bg-white/58 p-6 backdrop-blur-sm shadow-[0_18px_44px_rgba(23,51,45,0.08)]">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-teal-800/15 bg-teal-700/10 text-sm font-semibold text-teal-800">
                  {index + 1}
                </div>
                <p className="mt-5 text-sm leading-7 text-[#17332d]/68">{moment}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pipeline" className="landing-section mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10">
          <p className="text-xs uppercase tracking-[0.28em] text-teal-800/80">Why the AI matters</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#17332d] sm:text-4xl">
            A pipeline built for correctness, not AI theater.
          </h2>
        </div>

        <div className="rounded-[2rem] border border-[#17332d]/10 bg-white/58 p-6 backdrop-blur-sm shadow-[0_20px_50px_rgba(23,51,45,0.08)]">
          <div className="grid gap-5 md:grid-cols-2">
            {[
              {
                title: 'Evidence-backed recommendations',
                body: 'Every opportunity starts with transcript claims, scene frames, or multimodal evidence before it ever reaches a creator.',
              },
              {
                title: 'Creator review stays in control',
                body: 'Creators approve, edit, reject, and republish from a real review queue with ranking, hints, and provenance.',
              },
              {
                title: 'Subscriber experience stays premium',
                body: 'Access-aware ranking, premium unlocks, follows, saves, and storefront publishing all stay aligned with creator intent.',
              },
              {
                title: 'Revenue loop is already wired',
                body: 'Affiliate clicks, subscriptions, and dashboard analytics all connect back to the storefront flow instead of living in a separate silo.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-[1.5rem] border border-[#17332d]/8 bg-white/62 p-5">
                <h3 className="text-lg font-semibold text-[#17332d]">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#17332d]/66">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-10 pt-8">
        <p className="text-xs uppercase tracking-[0.28em] text-teal-800/80">Private beta</p>
        <h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight text-[#17332d] sm:text-4xl">
          We are onboarding a small set of travel creators and the subscribers who already trust them.
        </h2>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-[#17332d]/62 sm:text-base">
          If you want a storefront that turns your vlogs into unlockable trip planning, join the waitlist.
          If you love following creators for where they stayed, what they packed, and how they planned a trip, start in discover.
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <Link href="/waitlist" className="btn-primary inline-flex items-center justify-center px-6 py-3 text-sm">
            Request creator access
          </Link>
          <Link href="/discover" className="btn-ghost inline-flex items-center justify-center px-6 py-3 text-sm">
            Browse creator storefronts
          </Link>
        </div>
      </section>

      <footer className="px-6 pb-12">
        <div className="mx-auto max-w-7xl border-t border-[#17332d]/10 pt-6">
          <PublicCopyright className="text-center text-xs uppercase tracking-[0.22em] text-[#17332d]/42" />
        </div>
      </footer>
    </main>
  )
}

