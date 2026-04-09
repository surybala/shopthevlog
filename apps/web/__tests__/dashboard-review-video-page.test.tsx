import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockVlogFindFirst = vi.fn()
const mockCreatorMemoryFindMany = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
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
    vlog: {
      findFirst: (...args: unknown[]) => mockVlogFindFirst(...args),
    },
    creatorMemory: {
      findMany: (...args: unknown[]) => mockCreatorMemoryFindMany(...args),
    },
  },
}))

vi.mock('../app/dashboard/review/ReviewDecisionButtons', () => ({
  default: ({ opportunityId }: { opportunityId: string }) =>
    React.createElement('div', { 'data-opportunity-id': opportunityId }, 'DecisionButtons'),
}))

vi.mock('../app/dashboard/review/ReviewEditForm', () => ({
  default: ({ opportunityId }: { opportunityId: string }) =>
    React.createElement('div', { 'data-opportunity-id': opportunityId }, 'EditForm'),
}))

import DashboardReviewVideoPage from '../app/dashboard/review/[vlogId]/page'

describe('DashboardReviewVideoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockCreatorMemoryFindMany.mockResolvedValue([
      { key: 'park hyatt tokyo', memoryType: 'ACCEPTED_PLACE', valueJson: {} },
      { key: 'park hyatt tokyo', memoryType: 'RECURRING_ITEM', valueJson: {} },
    ])
    mockVlogFindFirst.mockResolvedValue({
      id: 'vlog-1',
      title: 'Tokyo vlog',
      externalUrl: 'https://youtube.com/watch?v=abc',
      thumbnailUrl: null,
      processingStatus: 'REVIEW_PENDING',
      opportunities: [
        {
          id: 'opp-1',
          title: 'Park Hyatt Tokyo',
          description: 'Luxury hotel featured during the Tokyo leg.',
          opportunityType: 'HOTEL',
          reviewState: 'UNREVIEWED',
          publishState: 'DRAFT',
          confidence: 0.92,
          rankScore: 0.88,
          metadataJson: {
            reviewRecommendation: 'likely_approve',
            reviewRecommendationReason: 'Creator history suggests this opportunity is likely a good fit, but it still needs a quick review.',
          },
          candidateEntity: {
            canonicalLabel: 'Park Hyatt Tokyo',
            rawLabel: 'Park Hyatt',
            entityType: 'PLACE',
            subtype: 'hotel',
            startSec: 45,
            endSec: 90,
          },
          evidences: [
            { evidence: { sourceType: 'TRANSCRIPT', startSec: 45, endSec: 60 } },
            { evidence: { sourceType: 'SCENE_SUMMARY', startSec: 50, endSec: 75 } },
          ],
        },
      ],
    })
  })

  it('renders the per-vlog review detail view', async () => {
    const page = await DashboardReviewVideoPage({ params: { vlogId: 'vlog-1' } })
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Tokyo vlog')
    expect(html).toContain('Back to review queue')
    expect(html).toContain('Park Hyatt Tokyo')
    expect(html).toContain('Previously approved')
    expect(html).toContain('Recurring item')
    expect(html).toContain('Likely approve')
    expect(html).toContain('likely a good fit')
    expect(html).toContain('EditForm')
    expect(html).toContain('DecisionButtons')
  })
})
