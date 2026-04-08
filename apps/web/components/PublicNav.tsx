/**
 * PublicNav — auth-aware top nav used on public pages (discover, storefronts, etc.)
 *
 * Pass the Supabase `user` object and whether they are a creator.
 * - Signed out   → "Sign in" + "Start free"
 * - Signed in    → avatar initial + display name + link to dashboard / account
 */
import Link from 'next/link'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'

interface Props {
  user: User | null
  /** If true, the account link points to /dashboard; otherwise /account */
  isCreator?: boolean
  /** Extra items to render in the centre/left of the nav */
  leftSlot?: React.ReactNode
  /** Extra items to render alongside the user section */
  rightSlot?: React.ReactNode
}

export default function PublicNav({ user, isCreator = false, leftSlot, rightSlot }: Props) {
  const displayName =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email?.split('@')[0] ??
    'Account'

  const initial = displayName[0]?.toUpperCase() ?? '?'
  const accountHref = isCreator ? '/dashboard' : '/account'

  return (
    <nav className="border-b border-white/10 bg-black/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Left: logo + optional slot */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-1.5 shrink-0">
            <Image
              src="/logo.png"
              alt="VlogShopper"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="text-base font-bold">VlogShopper</span>
          </Link>
          {leftSlot}
        </div>

        {/* Right: auth state + optional slot */}
        <div className="flex items-center gap-3">
          {rightSlot}

          {user ? (
            /* ── Signed in ─────────────────────────────────────────────── */
            <Link
              href={accountHref}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors group"
            >
              {/* Avatar initial */}
              <span className="w-6 h-6 rounded-full bg-white/20 text-white text-xs font-semibold flex items-center justify-center leading-none group-hover:bg-white/30 transition-colors">
                {initial}
              </span>
              <span className="text-sm text-white/70 group-hover:text-white transition-colors max-w-[140px] truncate">
                {displayName}
              </span>
              {isCreator && (
                <span className="text-xs text-white/30 hidden sm:inline">Dashboard ↗</span>
              )}
            </Link>
          ) : (
            /* ── Signed out ────────────────────────────────────────────── */
            <>
              <Link
                href="/login"
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                Sign in
              </Link>
              <Link href="/signup" className="btn-primary text-sm py-1.5 px-4">
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
