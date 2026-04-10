import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockTripKitFindMany = vi.fn()
const mockAffiliateLinkFindMany = vi.fn()
const mockCommissionFindMany = vi.fn()
const mockClickEventCount = vi.fn()
const mockCommissionCount = vi.fn()
const mockCommissionAggregate = vi.fn()
const mockClickEventGroupBy = vi.fn()
const mockCommissionGroupBy = vi.fn()

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
    tripKit: {
      findMany: (...args: unknown[]) => mockTripKitFindMany(...args),
    },
    affiliateLink: {
      findMany: (...args: unknown[]) => mockAffiliateLinkFindMany(...args),
    },
    commission: {
      findMany: (...args: unknown[]) => mockCommissionFindMany(...args),
      count: (...args: unknown[]) => mockCommissionCount(...args),
      aggregate: (...args: unknown[]) => mockCommissionAggregate(...args),
      groupBy: (...args: unknown[]) => mockCommissionGroupBy(...args),
    },
    clickEvent: {
      count: (...args: unknown[]) => mockClickEventCount(...args),
      groupBy: (...args: unknown[]) => mockClickEventGroupBy(...args),
    },
  },
}))

import DashboardAnalyticsPage from '../app/dashboard/analytics/page'

describe('DashboardAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockTripKitFindMany.mockResolvedValue([
      {
        id: 'kit-1',
        title: 'Tokyo Spring Edit',
        slug: 'tokyo-spring-edit',
        viewCount: 2000,
        clickCount: 150,
        saveCount: 40,
        conversionCount: 12,
        estimatedEarnings: 340.25,
      },
    ])
    mockAffiliateLinkFindMany.mockResolvedValue([
      {
        id: 'link-1',
        targetName: 'Park Hyatt Tokyo',
        provider: 'GETYOURGUIDE',
        clickCount: 120,
        conversionCount: 8,
        totalEarnings: 215.5,
      },
    ])
    mockCommissionFindMany.mockResolvedValue([{ provider: 'GETYOURGUIDE', creatorEarnings: 21550, status: 'PAID' }])
    mockClickEventCount.mockResolvedValue(400)
    mockCommissionCount.mockResolvedValue(16)
    mockCommissionAggregate.mockResolvedValue({ _sum: { creatorEarnings: 48250 } })
    mockClickEventGroupBy.mockResolvedValue([{ tripKitId: 'kit-1', _count: { tripKitId: 42 } }])
    mockCommissionGroupBy.mockResolvedValue([{ affiliateLinkId: 'link-1', _count: { affiliateLinkId: 8 }, _sum: { creatorEarnings: 21550 } }])
  })

  it('renders the refreshed analytics dashboard shell', async () => {
    const page = await DashboardAnalyticsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Performance analytics')
    expect(html).toContain('Understand what people explore, click, and convert from your world.')
    expect(html).toContain('Earnings by Provider (30d)')
    expect(html).toContain('Top Earning Kits (7d)')
    expect(html).toContain('Tokyo Spring Edit')
  })
})
