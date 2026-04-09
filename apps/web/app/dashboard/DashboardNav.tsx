'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '[ ]' },
  { href: '/dashboard/vlogs', label: 'Vlogs', icon: '[V]' },
  { href: '/dashboard/review', label: 'Review Queue', icon: '[R]' },
  { href: '/dashboard/kits', label: 'Trip Kits', icon: '[K]' },
  { href: '/dashboard/affiliates', label: 'Affiliate Links', icon: '[L]' },
  { href: '/dashboard/subscribers', label: 'Subscribers', icon: '[S]' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '[A]' },
  { href: '/dashboard/payouts', label: 'Payouts', icon: '[$]' },
  { href: '/dashboard/settings', label: 'Settings', icon: '[*]' },
]

const adminNavItems = [
  { href: '/dashboard/waitlist', label: 'Waitlist', icon: '[!]' },
]

export default function DashboardNav({ handle, isAdmin = false }: { handle: string | null; isAdmin?: boolean }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
      {[...navItems, ...(isAdmin ? adminNavItems : [])].map((item) => {
        const active = item.href === '/dashboard'
          ? pathname === '/dashboard'
          : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              active
                ? 'bg-white/10 text-white font-medium'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-xs leading-none font-mono">{item.icon}</span>
            {item.label}
          </Link>
        )
      })}

      <div className="pt-3 mt-3 border-t border-white/10 space-y-0.5">
        <Link
          href="/account"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
        >
          <span className="text-xs leading-none font-mono">[U]</span>
          My Account
        </Link>
        {handle && (
          <Link
            href={`/@${handle}`}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="text-xs leading-none font-mono">[>]</span>
            View Storefront
          </Link>
        )}
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors text-left"
          >
            <span className="text-xs leading-none font-mono">[X]</span>
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
