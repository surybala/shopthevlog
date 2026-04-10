import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockCommissionFindMany = vi.fn()
const mockCommissionAggregate = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
    commission: {
      findMany: (...args: unknown[]) => mockCommissionFindMany(...args),
      aggregate: (...args: unknown[]) => mockCommissionAggregate(...args),
    },
  },
}))

import DashboardPayoutsPage from '../app/dashboard/payouts/page'

describe('DashboardPayoutsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1', stripeAccountId: null })
    mockCommissionFindMany.mockResolvedValue([
      {
        id: 'comm-1',
        provider: 'GETYOURGUIDE',
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        status: 'PENDING',
        creatorEarnings: 1850,
      },
    ])
    mockCommissionAggregate
      .mockResolvedValueOnce({ _sum: { creatorEarnings: 1850 } })
      .mockResolvedValueOnce({ _sum: { creatorEarnings: 9400 } })
  })

  it('renders the refreshed payouts dashboard shell', async () => {
    const page = await DashboardPayoutsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Creator payouts')
    expect(html).toContain('Stay on top of what is pending, paid, and about to land.')
    expect(html).toContain('Connect Stripe to receive payouts')
    expect(html).toContain('Commission History')
    expect(html).toContain('GETYOURGUIDE')
  })
})
