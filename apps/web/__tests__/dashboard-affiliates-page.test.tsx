import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockAffiliateLinkFindMany = vi.fn()
const mockCommissionFindMany = vi.fn()

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
    affiliateLink: {
      findMany: (...args: unknown[]) => mockAffiliateLinkFindMany(...args),
    },
    commission: {
      findMany: (...args: unknown[]) => mockCommissionFindMany(...args),
    },
  },
}))

import DashboardAffiliatesPage from '../app/dashboard/affiliates/page'

describe('DashboardAffiliatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockAffiliateLinkFindMany.mockResolvedValue([
      {
        id: 'link-1',
        targetName: 'Park Hyatt Tokyo',
        provider: 'GETYOURGUIDE',
        clickCount: 120,
        conversionCount: 8,
        totalEarnings: 215.5,
        city: 'Tokyo',
        shortCode: 'abc123',
        priceFrom: '$48',
        affiliateUrl: 'https://example.com',
        isActive: true,
        tripKits: [{ id: 'kit-1', title: 'Tokyo Stay Guide' }],
      },
    ])
    mockCommissionFindMany.mockResolvedValue([
      {
        id: 'comm-1',
        provider: 'GETYOURGUIDE',
        status: 'CONFIRMED',
        creatorEarnings: 21550,
        affiliateLink: { targetName: 'Park Hyatt Tokyo' },
        attributedTripKit: { title: 'Tokyo Stay Guide' },
      },
    ])
  })

  it('renders the richer affiliates dashboard shell', async () => {
    const page = await DashboardAffiliatesPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Revenue links')
    expect(html).toContain('Track what subscribers tap, book, and buy across every storefront surface.')
    expect(html).toContain('Provider earnings mix')
    expect(html).toContain('Top earning kits')
    expect(html).toContain('Recent commission activity')
    expect(html).toContain('Tokyo Stay Guide')
    expect(html).toContain('Park Hyatt Tokyo')
    expect(html).toContain('Confirmed Earnings')
  })
})
