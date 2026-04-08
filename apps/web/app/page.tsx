import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export default async function HomePage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect creators straight to their dashboard
  if (user) {
    const creator = await prisma.creator.findUnique({
      where: { userId: user.id },
      select: { handle: true },
    })
    if (creator) redirect('/dashboard')
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="VlogShopper" width={32} height={32} className="rounded-lg" />
            <span className="text-xl font-bold tracking-tight">VlogShopper</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/discover" className="text-white/60 hover:text-white text-sm transition-colors">
              Discover
            </Link>
            {user ? (
              // Creators are redirected before reaching here — this is subscribers only
              <Link
                href="/account"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors group"
              >
                <span className="w-6 h-6 rounded-full bg-white/20 text-white text-xs font-semibold flex items-center justify-center leading-none">
                  {(user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? user.email ?? '?')[0].toUpperCase()}
                </span>
                <span className="text-sm text-white/70 group-hover:text-white transition-colors">
                  {user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'Account'}
                </span>
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-white/60 hover:text-white text-sm transition-colors">
                  Sign in
                </Link>
                <Link href="/signup" className="btn-primary text-sm">
                  Start for free
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-24 px-6 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-white/60 text-xs mb-8">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Creator-first · Zero extra work · Passive income
        </div>

        <h1 className="text-6xl sm:text-7xl font-bold tracking-tight leading-none mb-6">
          Your vlogs.
          <br />
          <span className="text-white/40">Now shoppable.</span>
        </h1>

        <p className="text-xl text-white/50 max-w-2xl mx-auto mb-10">
          Connect your YouTube or TikTok channel. AI scans your back-catalog and builds{' '}
          <strong className="text-white/70">Trip Kits</strong> — shoppable itineraries
          your audience can browse, save, and book from your own branded storefront.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/signup" className="btn-primary text-base px-8 py-3">
            Create your storefront →
          </Link>
          <Link href="/discover" className="btn-ghost text-base px-8 py-3">
            Browse creators
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">How it works</h2>
        <p className="text-white/50 text-center mb-16 max-w-xl mx-auto">
          From channel connection to passive income in under 10 minutes.
        </p>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: '01',
              title: 'Connect your channel',
              desc: 'Link your YouTube or TikTok. We fetch your vlog catalog — you do nothing else.',
              icon: '📡',
            },
            {
              step: '02',
              title: 'AI builds Trip Kits',
              desc: 'Our pipeline transcribes, extracts every hotel, restaurant, and experience from your vlogs, and generates day-by-day itineraries.',
              icon: '🤖',
            },
            {
              step: '03',
              title: 'Your audience books, you earn',
              desc: 'Publish your storefront. Fans subscribe, save kits, and click affiliate links. You earn commissions — passively.',
              icon: '💸',
            },
          ].map((item) => (
            <div key={item.step} className="glass-card p-8">
              <div className="text-4xl mb-4">{item.icon}</div>
              <div className="text-white/30 text-xs font-mono mb-2">STEP {item.step}</div>
              <h3 className="text-lg font-semibold mb-3">{item.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue streams */}
      <section className="py-24 px-6 bg-white/[0.02] border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Multiple income streams. Zero extra work.</h2>
          <p className="text-white/50 text-center mb-16 max-w-xl mx-auto">
            VlogShopper monetises your existing content, not your future time.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Affiliate commissions', sub: 'Hotels, experiences, gear', color: 'from-blue-500/20 to-blue-500/5', icon: '🔗' },
              { label: 'Subscriptions', sub: 'Monthly fan memberships', color: 'from-purple-500/20 to-purple-500/5', icon: '💳' },
              { label: 'Digital products', sub: 'Guides, presets, templates', color: 'from-green-500/20 to-green-500/5', icon: '📄' },
              { label: 'Merch', sub: 'Print-on-demand via Printful', color: 'from-orange-500/20 to-orange-500/5', icon: '👕' },
            ].map((item) => (
              <div key={item.label} className={`glass-card p-6 bg-gradient-to-br ${item.color}`}>
                <div className="text-3xl mb-3">{item.icon}</div>
                <div className="font-semibold mb-1">{item.label}</div>
                <div className="text-white/40 text-sm">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 text-center">
        <h2 className="text-4xl font-bold mb-4">Ready to monetise your back-catalog?</h2>
        <p className="text-white/50 mb-10 max-w-lg mx-auto">
          Free to start. No credit card required. Your first Trip Kit is ready in minutes.
        </p>
        <Link href="/signup" className="btn-primary text-base px-10 py-4">
          Create your free storefront
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-bold">VlogShopper</span>
          <p className="text-white/30 text-sm">© 2025 VlogShopper. Creator-first travel commerce.</p>
          <div className="flex gap-6 text-white/40 text-sm">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
