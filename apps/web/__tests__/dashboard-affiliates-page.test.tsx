import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockAffiliateLinkFindMany = vi.fn()

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
      },
    ])
  })

  it('renders the refreshed affiliates dashboard shell', async () => {
    const page = await DashboardAffiliatesPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Revenue links')
    expect(html).toContain('Track what your audience taps, books, and buys.')
    expect(html).toContain('Park Hyatt Tokyo')
    expect(html).toContain('GETYOURGUIDE')
    expect(html).toContain('Total Clicks')
  })
})
