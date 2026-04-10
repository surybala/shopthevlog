import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
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
    tripKit: {
      findMany: (...args: unknown[]) => mockTripKitFindMany(...args),
    },
  },
}))

import DashboardKitsPage from '../app/dashboard/kits/page'

describe('DashboardKitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1', handle: 'alex', plan: 'PRO' })
    mockTripKitFindMany.mockResolvedValue([
      {
        id: 'kit-1',
        title: 'Lisbon Weekend',
        slug: 'lisbon-weekend',
        isPublished: true,
        generatedByAI: true,
        viewCount: 420,
        clickCount: 31,
        estimatedEarnings: 88,
        primaryCity: 'Lisbon',
        durationDays: 3,
        accessTier: 'FOLLOWER',
        coverImageUrl: null,
        _count: { affiliateLinks: 6, days: 3 },
      },
    ])
  })

  it('renders the refreshed kits dashboard shell', async () => {
    const page = await DashboardKitsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Trip Kit library')
    expect(html).toContain('Shape the travel guides your audience keeps coming back to.')
    expect(html).toContain('Lisbon Weekend')
    expect(html).toContain('AI generated')
    expect(html).toContain('dashboard-mirror-panel')
    expect(html).toContain('dashboard-mirror-card')
  })
})
