import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockTripKitFindMany = vi.fn()
const mockAccessMap = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('@/components/PublicNav', () => ({
  default: () => React.createElement('nav', null),
}))

vi.mock('@/lib/viewerAccess', () => ({
  getViewerCreatorAccessMap: (...args: unknown[]) => mockAccessMap(...args),
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

import DiscoverPage from '../app/discover/page'

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockCreatorFindUnique.mockResolvedValue(null)
    mockAccessMap.mockResolvedValue({})
    mockTripKitFindMany
      .mockResolvedValueOnce([
        {
          id: 'kit-1',
          title: 'Lisbon Food Weekend',
          slug: 'lisbon-food-weekend',
          coverImageUrl: null,
          sourceVlogs: [{ vlog: { thumbnailUrl: 'https://img.youtube.com/vi/lisbon-search/hqdefault.jpg' } }],
          primaryCity: 'Lisbon',
          countries: ['Portugal'],
          creatorId: 'creator-1',
          durationDays: 3,
          accessTier: 'FREE',
          viewCount: 120,
          saveCount: 12,
          estimatedBudgetLow: 650,
          estimatedBudgetHigh: 980,
          travelStyle: ['FOOD'],
          description: 'Cafe hopping and market stops.',
          creator: { handle: 'alex', displayName: 'Alex Wanders', avatarUrl: null },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'kit-2',
          title: 'Tokyo Mornings',
          slug: 'tokyo-mornings',
          coverImageUrl: null,
          sourceVlogs: [{ vlog: { thumbnailUrl: 'https://img.youtube.com/vi/tokyo-trending/hqdefault.jpg' } }],
          primaryCity: 'Tokyo',
          countries: ['Japan'],
          creatorId: 'creator-2',
          durationDays: 4,
          accessTier: 'FREE',
          viewCount: 240,
          creator: { handle: 'maya', displayName: 'Maya Miles' },
        },
      ])
      .mockResolvedValueOnce([{ countries: ['Portugal', 'Japan'] }])
  })

  it('uses source vlog thumbnails when kit covers are missing', async () => {
    const page = await DiscoverPage({ searchParams: {} })
    const html = renderToStaticMarkup(page)

    expect(html).toContain('https://img.youtube.com/vi/lisbon-search/hqdefault.jpg')
    expect(html).toContain('https://img.youtube.com/vi/tokyo-trending/hqdefault.jpg')
    expect(html).not.toContain('>🗺<')
  })
})
