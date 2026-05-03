import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockTripKitFindFirst = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockSavedKitFindUnique = vi.fn()
const mockFollowFindUnique = vi.fn()
const mockSubscriptionFindFirst = vi.fn()
const mockTripKitUpdate = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

vi.mock('@/components/SaveKitButton', () => ({
  default: ({ initialSaved }: { initialSaved: boolean }) =>
    React.createElement('button', { className: 'storefront-outline-button' }, initialSaved ? 'Saved' : 'Save'),
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
      findFirst: (...args: unknown[]) => mockTripKitFindFirst(...args),
      update: (...args: unknown[]) => mockTripKitUpdate(...args),
    },
    subscriber: {
      findUnique: (...args: unknown[]) => mockSubscriberFindUnique(...args),
    },
    savedKit: {
      findUnique: (...args: unknown[]) => mockSavedKitFindUnique(...args),
    },
    follow: {
      findUnique: (...args: unknown[]) => mockFollowFindUnique(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => mockSubscriptionFindFirst(...args),
    },
  },
}))

import KitDetailPage from '../app/store/[handle]/kits/[slug]/page'

describe('KitDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      avatarUrl: 'creators/creator-1/storefront/avatar.jpg',
      isPublished: true,
      storefrontTheme: 'BEACH_RETREAT',
    })
    mockTripKitFindFirst.mockResolvedValue({
      id: 'kit-1',
      title: 'Three Islands in Thailand',
      slug: 'three-islands-thailand',
      description: 'Dive days, beach stays, and ferry hops.',
      coverImageUrl: 'creators/creator-1/kits/cover.jpg',
      primaryCity: 'Koh Tao',
      durationDays: 10,
      estimatedBudgetLow: 800,
      estimatedBudgetHigh: 1800,
      accessTier: 'FREE',
      isPublished: true,
      days: [
        {
          id: 'day-1',
          title: 'Day 1 - Koh Tao: Arrive and Dive',
          summary: 'Settle in and head to your first open water session.',
          tips: ['Book the early ferry'],
          activities: [
            {
              id: 'activity-1',
              time: '09:00',
              title: 'Crystal Dive - PADI Open Water Day 1',
              description: 'Morning dive lesson with rental gear included.',
              affiliateLink: {
                shortCode: 'ABC123',
                provider: 'GETYOURGUIDE',
                priceFrom: '$250',
              },
            },
          ],
        },
      ],
      sections: [],
      sourceVlogs: [
        {
          vlogId: 'vlog-1',
          vlog: {
            title: 'Kadavuley! Skiing chaos',
            externalUrl: 'https://youtube.com/watch?v=123',
            platform: 'YOUTUBE',
            externalId: '123',
          },
        },
      ],
    })
    mockSubscriberFindUnique.mockResolvedValue(null)
    mockSavedKitFindUnique.mockResolvedValue(null)
    mockFollowFindUnique.mockResolvedValue(null)
    mockSubscriptionFindFirst.mockResolvedValue(null)
    mockTripKitUpdate.mockResolvedValue({})
  })

  it('renders the kit detail page with stronger storefront detail contrast classes', async () => {
    const page = await KitDetailPage({ params: { handle: 'alexwanders', slug: 'three-islands-thailand' } })
    const html = renderToStaticMarkup(page)

    expect(html).toContain('storefront-detail-page')
    expect(html).toContain('storefront-detail-affiliate-link')
    expect(html).toContain('Three Islands in Thailand')
    expect(html).toContain('Day 1 - Koh Tao: Arrive and Dive')
    expect(html).toContain('Book on GETYOURGUIDE')
    expect(html).not.toContain('text-white')
  })
})
