import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockSubscriptionFindMany = vi.fn()
const mockFollowCount = vi.fn()
const mockSubscriptionTierFindMany = vi.fn()

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
    subscription: {
      findMany: (...args: unknown[]) => mockSubscriptionFindMany(...args),
    },
    follow: {
      count: (...args: unknown[]) => mockFollowCount(...args),
    },
    subscriptionTier: {
      findMany: (...args: unknown[]) => mockSubscriptionTierFindMany(...args),
    },
  },
}))

import DashboardSubscribersPage from '../app/dashboard/subscribers/page'

describe('DashboardSubscribersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockFollowCount.mockResolvedValue(430)
    mockSubscriptionFindMany.mockResolvedValue([
      {
        id: 'sub-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        tier: { name: 'Insider', monthlyPrice: 1200 },
        subscriber: { displayName: 'Jamie', avatarUrl: null },
      },
    ])
    mockSubscriptionTierFindMany.mockResolvedValue([
      {
        id: 'tier-1',
        name: 'Insider',
        monthlyPrice: 1200,
        _count: { subscriptions: 1 },
      },
    ])
  })

  it('renders the refreshed subscribers dashboard shell', async () => {
    const page = await DashboardSubscribersPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Audience relationships')
    expect(html).toContain('See who follows your travel world and who pays to go deeper.')
    expect(html).toContain('Tier Breakdown')
    expect(html).toContain('Jamie')
    expect(html).toContain('MRR')
  })
})
