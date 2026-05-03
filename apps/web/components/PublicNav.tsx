/**
 * PublicNav — auth-aware top nav used on public pages (discover, creator portals, etc.)
 */
import Link from 'next/link'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'

interface Props {
  user: User | null
  isCreator?: boolean
  leftSlot?: React.ReactNode
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
    <nav className="sticky top-0 z-50 border-b border-[#1f3e36]/10 bg-[rgba(255,248,240,0.88)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/logo.png" alt="TripKits" width={24} height={24} className="rounded-md" />
            <span className="text-base font-bold text-[#17332d]">TripKits</span>
          </Link>
          {leftSlot}
        </div>

        <div className="flex items-center gap-3">
          {rightSlot}

          {user ? (
            <Link
              href={accountHref}
              className="group flex items-center gap-2 rounded-xl border border-[#1f3e36]/10 bg-white/55 px-3 py-1.5 transition-colors hover:border-[#1f3e36]/20 hover:bg-white/80"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#17332d]/10 text-xs font-semibold leading-none text-[#17332d] transition-colors group-hover:bg-[#17332d]/15">
                {initial}
              </span>
              <span className="max-w-[140px] truncate text-sm text-[#17332d]/75 transition-colors group-hover:text-[#17332d]">
                {displayName}
              </span>
              {isCreator && (
                <span className="hidden text-xs text-[#17332d]/35 sm:inline">Dashboard ↗</span>
              )}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm text-[#17332d]/58 transition-colors hover:text-[#17332d]"
              >
                Sign in
              </Link>
              <Link href="/waitlist" className="btn-primary px-4 py-1.5 text-sm">
                Request access
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
