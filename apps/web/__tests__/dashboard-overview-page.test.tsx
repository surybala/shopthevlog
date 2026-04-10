import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockCommissionAggregate = vi.fn()
const mockClickEventCount = vi.fn()
const mockCommissionCount = vi.fn()
const mockTripKitFindMany = vi.fn()

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
      aggregate: (...args: unknown[]) => mockCommissionAggregate(...args),
      count: (...args: unknown[]) => mockCommissionCount(...args),
    },
    clickEvent: {
      count: (...args: unknown[]) => mockClickEventCount(...args),
    },
    tripKit: {
      findMany: (...args: unknown[]) => mockTripKitFindMany(...args),
    },
  },
}))

import DashboardOverviewPage from '../app/dashboard/page'

describe('DashboardOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      isPublished: true,
      catalogScanStatus: 'COMPLETE',
      _count: {
        tripKits: 4,
        subscribers: 126,
        affiliateLinks: 18,
      },
    })
    mockCommissionAggregate
      .mockResolvedValueOnce({ _sum: { creatorEarnings: 654321 } })
      .mockResolvedValueOnce({ _sum: { creatorEarnings: 12000 } })
      .mockResolvedValueOnce({ _sum: { creatorEarnings: 4200 } })
    mockClickEventCount.mockResolvedValue(324)
    mockCommissionCount.mockResolvedValue(18)
    mockTripKitFindMany.mockResolvedValue([
      {
        id: 'kit-1',
        title: 'Tokyo Spring Edit',
        slug: 'tokyo-spring-edit',
        isPublished: true,
        viewCount: 1240,
        clickCount: 81,
        accessTier: 'PREMIUM',
        createdAt: new Date('2026-04-08T00:00:00.000Z'),
      },
    ])
  })

  it('renders the upgraded creator dashboard overview shell', async () => {
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Creator command center')
    expect(html).toContain('Good morning, Alex')
    expect(html).toContain('Last 7 Days')
    expect(html).toContain('Recent Trip Kits')
    expect(html).toContain('Tokyo Spring Edit')
    expect(html).toContain('dashboard-mirror-panel')
    expect(html).toContain('dashboard-mirror-card')
    expect(html).toContain('text-4xl font-semibold tracking-tight text-[#f7f1e4]')
  })
})
