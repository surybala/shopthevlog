import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockOpportunityFindMany = vi.fn()
const mockCreatorMemoryFindMany = vi.fn()

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
    opportunity: {
      findMany: (...args: unknown[]) => mockOpportunityFindMany(...args),
    },
    creatorMemory: {
      findMany: (...args: unknown[]) => mockCreatorMemoryFindMany(...args),
    },
  },
}))

vi.mock('../app/dashboard/review/ReviewDecisionButtons', () => ({
  default: ({ opportunityId, reviewState }: { opportunityId: string; reviewState: string }) =>
    React.createElement('div', { 'data-opportunity-id': opportunityId, 'data-review-state': reviewState }, 'DecisionButtons'),
}))

import DashboardReviewPage from '../app/dashboard/review/page'

describe('DashboardReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockCreatorMemoryFindMany.mockResolvedValue([
      { key: 'park hyatt tokyo', memoryType: 'REJECTED_PRODUCT', valueJson: {} },
      { key: 'park hyatt tokyo', memoryType: 'NAMING_PREFERENCE', valueJson: { preferredTitle: 'Park Hyatt Tokyo' } },
    ])
    mockOpportunityFindMany.mockResolvedValue([
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
          reviewRecommendation: 'needs_scrutiny',
          reviewRecommendationReason: 'Creator history shows a similar item was rejected before, so this should be reviewed manually.',
        },
        candidateEntity: {
          canonicalLabel: 'Park Hyatt Tokyo',
          rawLabel: 'Park Hyatt',
          startSec: 45,
          endSec: 90,
        },
        vlog: {
          id: 'vlog-1',
          title: 'Tokyo vlog',
          externalUrl: 'https://youtube.com/watch?v=abc',
          thumbnailUrl: null,
        },
        evidences: [
          { evidence: { sourceType: 'TRANSCRIPT', startSec: 45, endSec: 60 } },
          { evidence: { sourceType: 'SCENE_SUMMARY', startSec: 50, endSec: 75 } },
        ],
      },
    ])
  })

  it('renders the review queue summary and opportunities', async () => {
    const page = await DashboardReviewPage()
    const html = renderToStaticMarkup(page)

    expect(mockOpportunityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishState: { in: ['DRAFT'] },
        }),
      })
    )
    expect(html).toContain('Review Queue')
    expect(html).toContain('Park Hyatt Tokyo')
    expect(html).toContain('Needs Review')
    expect(html).toContain('min-h-[2.5rem]')
    expect(html).toContain('dashboard-mirror-panel')
    expect(html).toContain('dashboard-mirror-card')
    expect(html).toContain('Transcript, Scene Summary')
    expect(html).toContain('Previously rejected')
    expect(html).toContain('Preferred naming: Park Hyatt Tokyo')
    expect(html).toContain('Needs scrutiny')
    expect(html).toContain('rejected before')
    expect(html).toContain('DecisionButtons')
  })
})
