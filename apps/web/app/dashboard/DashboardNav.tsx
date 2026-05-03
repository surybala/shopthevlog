'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center text-[#17332d]/76" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  )
}

const navItems = [
  {
    href: '/dashboard',
    label: 'Overview',
    icon: <NavIcon><path d="M3 10.5 10 4l7 6.5" /><path d="M5.5 9.5V16h9V9.5" /></NavIcon>,
  },
  {
    href: '/dashboard/vlogs',
    label: 'Vlogs',
    icon: <NavIcon><rect x="3.5" y="5" width="13" height="10" rx="2" /><path d="m8 8 5 2-5 2V8Z" /></NavIcon>,
  },
  {
    href: '/dashboard/review',
    label: 'Review Queue',
    icon: <NavIcon><path d="M4 4.5h9l3 3V15.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" /><path d="M13 4.5v3h3" /><path d="M7 10h6" /><path d="M7 13h4" /></NavIcon>,
  },
  {
    href: '/dashboard/kits',
    label: 'Trip Kits',
    icon: <NavIcon><path d="M4.5 5.5h11v10h-11z" /><path d="M7 5.5v10" /><path d="M9 8.5h4" /></NavIcon>,
  },
  {
    href: '/dashboard/affiliates',
    label: 'Affiliate Links',
    icon: <NavIcon><path d="M8 12.5 6.2 14.3a2.5 2.5 0 1 1-3.5-3.6L4.5 9" /><path d="m12 7.5 1.8-1.8a2.5 2.5 0 1 1 3.5 3.6L15.5 11" /><path d="M7 13 13 7" /></NavIcon>,
  },
  {
    href: '/dashboard/subscribers',
    label: 'Subscribers',
    icon: <NavIcon><path d="M10 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path d="M5 15.5a5 5 0 0 1 10 0" /><path d="M3.5 8.5a2 2 0 1 0 0-4" /><path d="M16.5 8.5a2 2 0 1 1 0-4" /></NavIcon>,
  },
  {
    href: '/dashboard/insights',
    label: 'Insights',
    icon: <NavIcon><path d="M10 4.5v2" /><path d="M10 13.5v2" /><path d="M4.5 10h2" /><path d="M13.5 10h2" /><path d="M10 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path d="M10 14a4 4 0 0 0 0-8" /></NavIcon>,
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: <NavIcon><path d="M4.5 15.5V11" /><path d="M9.5 15.5V8" /><path d="M14.5 15.5V5" /><path d="M3.5 15.5h13" /></NavIcon>,
  },
  {
    href: '/dashboard/payouts',
    label: 'Payouts',
    icon: <NavIcon><path d="M10 4.5v11" /><path d="M13 7.5a3 3 0 0 0-6 0c0 1.7 6 1.3 6 4a3 3 0 0 1-6 0" /></NavIcon>,
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: <NavIcon><path d="M10 7.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z" /><path d="M10 3.5v1.4" /><path d="M10 15.1v1.4" /><path d="m5.7 5.7 1 1" /><path d="m13.3 13.3 1 1" /><path d="M3.5 10h1.4" /><path d="M15.1 10h1.4" /><path d="m5.7 14.3 1-1" /><path d="m13.3 6.7 1-1" /></NavIcon>,
  },
]

const adminNavItems = [
  {
    href: '/dashboard/waitlist',
    label: 'Waitlist',
    icon: <NavIcon><path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" /><path d="M10 7v3.5" /><path d="M10 13.5h.01" /></NavIcon>,
  },
  {
    href: '/dashboard/payout-ops',
    label: 'Payout Ops',
    icon: <NavIcon><path d="M4.5 6.5h11" /><path d="M4.5 10h11" /><path d="M4.5 13.5h7" /><path d="M14 13.5h2.5" /><path d="M13.5 4.5v11" /></NavIcon>,
  },
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
                ? 'bg-[#17332d]/10 text-[#17332d] font-semibold shadow-[inset_0_0_0_1px_rgba(23,51,45,0.08)]'
                : 'text-[#17332d]/76 hover:text-[#17332d] hover:bg-[#17332d]/6'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        )
      })}

      <div className="mt-3 space-y-0.5 border-t border-[#17332d]/10 pt-3">
        <Link
          href="/account"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#17332d]/76 transition-colors hover:bg-[#17332d]/6 hover:text-[#17332d]"
        >
          <NavIcon><path d="M10 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path d="M5.5 15.5a4.5 4.5 0 0 1 9 0" /></NavIcon>
          My Account
        </Link>
        {handle && (
          <Link
            href={`/@${handle}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#17332d]/76 transition-colors hover:bg-[#17332d]/6 hover:text-[#17332d]"
          >
            <NavIcon><path d="M4.5 10h9" /><path d="m10.5 6 4 4-4 4" /></NavIcon>
            View Storefront
          </Link>
        )}
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[#17332d]/76 transition-colors hover:bg-[#17332d]/6 hover:text-[#17332d]"
          >
            <NavIcon><path d="M7 6.5 13.5 13" /><path d="M13.5 6.5 7 13" /><path d="M4.5 4.5h11v11h-11z" /></NavIcon>
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
