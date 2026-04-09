import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockFollowFindMany = vi.fn()
const mockSubscriptionFindMany = vi.fn()
const mockSavedKitFindMany = vi.fn()

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
    subscriber: {
      findUnique: (...args: unknown[]) => mockSubscriberFindUnique(...args),
    },
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
    follow: {
      findMany: (...args: unknown[]) => mockFollowFindMany(...args),
    },
    subscription: {
      findMany: (...args: unknown[]) => mockSubscriptionFindMany(...args),
    },
    savedKit: {
      findMany: (...args: unknown[]) => mockSavedKitFindMany(...args),
    },
  },
}))

vi.mock('../app/account/UnfollowButton', () => ({
  default: ({ creatorHandle }: { creatorHandle: string }) =>
    React.createElement('button', { 'data-creator-handle': creatorHandle }, 'Unfollow'),
}))

vi.mock('../app/account/UnsaveButton', () => ({
  default: ({ kitId }: { kitId: string }) =>
    React.createElement('button', { 'data-kit-id': kitId }, 'Unsave'),
}))

import AccountPage from '../app/account/page'

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'premium@example.com',
        },
      },
    })
    mockSubscriberFindUnique.mockResolvedValue({ id: 'sub-1', displayName: 'Premium Subscriber' })
    mockCreatorFindUnique.mockResolvedValue(null)
    mockFollowFindMany.mockResolvedValue([
      {
        id: 'follow-1',
        creatorId: 'creator-1',
        followedAt: new Date('2026-04-09T00:00:00.000Z'),
        creator: {
          handle: 'qa-subscriber-e2e',
          displayName: 'Subscriber QA Creator',
          avatarUrl: null,
          bio: 'Subscriber QA creator bio.',
          subscriberCount: 42,
          isPublished: true,
          _count: { tripKits: 3 },
        },
      },
    ])
    mockSubscriptionFindMany.mockResolvedValue([
      {
        id: 'subscr-1',
        creatorId: 'creator-1',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date('2026-04-20T00:00:00.000Z'),
        tier: {
          name: 'Premium Insider',
          monthlyPrice: 999,
          perks: ['Premium kits unlocked'],
          kitAccess: 'PREMIUM',
        },
        creator: {
          handle: 'qa-subscriber-e2e',
          displayName: 'Subscriber QA Creator',
          avatarUrl: null,
        },
      },
    ])
    mockSavedKitFindMany.mockResolvedValue([])
  })

  it('shows premium access as active for followed creators when the subscription tier grants premium kit access', async () => {
    const page = await AccountPage({ searchParams: { tab: 'following' } })
    const html = renderToStaticMarkup(page)

    expect(mockSubscriptionFindMany).toHaveBeenCalledWith({
      where: { subscriberId: 'sub-1' },
      orderBy: { createdAt: 'desc' },
      include: {
        tier: { select: { name: true, monthlyPrice: true, perks: true, kitAccess: true } },
        creator: { select: { handle: true, displayName: true, avatarUrl: true } },
      },
    })
    expect(html).toContain('Subscriber QA Creator')
    expect(html).toContain('Premium access active')
  })
})
