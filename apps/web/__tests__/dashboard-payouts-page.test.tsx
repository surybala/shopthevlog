import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockCreatorUpdate = vi.fn()
const mockCommissionFindMany = vi.fn()
const mockSubscriptionFindMany = vi.fn()
const mockStripeRetrieve = vi.fn()

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
      update: (...args: unknown[]) => mockCreatorUpdate(...args),
    },
    commission: {
      findMany: (...args: unknown[]) => mockCommissionFindMany(...args),
    },
    subscription: {
      findMany: (...args: unknown[]) => mockSubscriptionFindMany(...args),
    },
  },
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    accounts: {
      retrieve: (...args: unknown[]) => mockStripeRetrieve(...args),
    },
  },
}))

import DashboardPayoutsPage from '../app/dashboard/payouts/page'

describe('DashboardPayoutsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      stripeAccountId: 'acct_123',
      payoutsEnabled: false,
    })
    mockStripeRetrieve.mockResolvedValue({
      payouts_enabled: true,
      charges_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
    })
    mockCommissionFindMany.mockResolvedValue([
      {
        id: 'comm-1',
        provider: 'GETYOURGUIDE',
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        status: 'CONFIRMED',
        creatorEarnings: 1850,
        affiliateLink: { targetName: 'Park Hyatt Tokyo' },
        attributedTripKit: { title: 'Tokyo Stay Guide', slug: 'tokyo-stay-guide' },
      },
      {
        id: 'comm-2',
        provider: 'VIATOR',
        createdAt: new Date('2026-04-05T00:00:00.000Z'),
        status: 'PAID',
        creatorEarnings: 6400,
        affiliateLink: { targetName: 'Tokyo Food Tour' },
        attributedTripKit: null,
      },
    ])
    mockSubscriptionFindMany.mockResolvedValue([
      {
        billingPeriod: 'MONTHLY',
        tier: { monthlyPrice: 1200, yearlyPrice: null },
      },
    ])
    mockCreatorUpdate.mockResolvedValue({})
  })

  it('renders the richer payouts dashboard and Stripe readiness state', async () => {
    const page = await DashboardPayoutsPage({})
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Creator payouts')
    expect(html).toContain('See what is earning now, what is ready to pay out, and what still needs setup.')
    expect(html).toContain('Payouts enabled')
    expect(html).toContain('Ready To Payout')
    expect(html).toContain('Subscriber Run-Rate')
    expect(html).toContain('Top earning kits')
    expect(html).toContain('Tokyo Stay Guide')
    expect(html).toContain('Open Stripe Dashboard')
    expect(mockCreatorUpdate).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { payoutsEnabled: true },
    })
  })
})
