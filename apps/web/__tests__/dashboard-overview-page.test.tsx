import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockVlogFindMany = vi.fn()
const mockVlogCount = vi.fn()
const mockChannelInsightFindUnique = vi.fn()

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
    auth: { getUser: mockGetUser },
  }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
    vlog: {
      findMany: (...args: unknown[]) => mockVlogFindMany(...args),
      count: (...args: unknown[]) => mockVlogCount(...args),
    },
    channelInsight: {
      findUnique: (...args: unknown[]) => mockChannelInsightFindUnique(...args),
    },
  },
}))

import DashboardOverviewPage from '../app/dashboard/page'

const baseCreator = {
  id: 'creator-1',
  userId: 'user-1',
  handle: 'alexwanders',
  displayName: 'Alex Wanders',
  isPublished: true,
  youtubeChannelId: 'UC_test',
  catalogScanStatus: 'COMPLETE',
}

const sampleVlogs = [
  {
    id: 'vlog-1',
    title: 'Tokyo Spring Trip',
    thumbnailUrl: 'https://img.example/1.jpg',
    viewCount: 12400,
    likeCount: 340,
    publishedAt: new Date('2026-03-01'),
    processingStatus: 'COMPLETE',
  },
  {
    id: 'vlog-2',
    title: 'Bali on $50 a Day',
    thumbnailUrl: null,
    viewCount: 8200,
    likeCount: 190,
    publishedAt: new Date('2026-02-10'),
    processingStatus: 'COMPLETE',
  },
]

describe('DashboardOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue(baseCreator)
    mockVlogFindMany.mockResolvedValue(sampleVlogs)
    mockVlogCount.mockResolvedValue(2)
    mockChannelInsightFindUnique.mockResolvedValue(null)
  })

  it('redirects unauthenticated users to login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    await expect(DashboardOverviewPage()).rejects.toThrow('REDIRECT:/login')
  })

  it('shows setup prompt when creator profile is missing', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)
    expect(html).toContain('Set up your profile')
  })

  it('renders the growth-focused overview for a creator with vlogs but no insights', async () => {
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)

    expect(html).toContain('Welcome back, Alex')
    expect(html).toContain('Creator Studio')
    expect(html).toContain('Run channel analysis')
    expect(html).toContain('Tokyo Spring Trip')
    expect(html).toContain('12,400')
    expect(html).toContain('Bali on $50 a Day')
  })

  it('shows import prompt when creator has no vlogs yet', async () => {
    mockVlogFindMany.mockResolvedValue([])
    mockVlogCount.mockResolvedValue(0)
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)
    expect(html).toContain('Import your YouTube videos')
  })

  it('shows connect YouTube prompt when channel is not linked', async () => {
    mockCreatorFindUnique.mockResolvedValue({ ...baseCreator, youtubeChannelId: null })
    mockVlogFindMany.mockResolvedValue([])
    mockVlogCount.mockResolvedValue(0)
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)
    expect(html).toContain('Connect YouTube to get started')
  })

  it('shows analysis running state when insight is in progress', async () => {
    mockChannelInsightFindUnique.mockResolvedValue({
      id: 'insight-1',
      status: 'ANALYZING',
      briefs: [],
      topPatterns: null,
    })
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)
    expect(html).toContain('Analysis running')
  })

  it('renders the top content brief when insights are complete', async () => {
    mockChannelInsightFindUnique.mockResolvedValue({
      id: 'insight-1',
      status: 'COMPLETE',
      topPatterns: JSON.stringify({
        channel_niche: 'budget Southeast Asia travel',
        top_patterns: ['Destination-specific titles drive 3x more clicks'],
        content_gaps: ['No content on visa processes despite high demand'],
      }),
      briefs: [
        {
          id: 'brief-1',
          title: 'How I Spent Only $40/Day in Bali',
          hookIdeas: JSON.stringify(['Start with the final budget reveal']),
          contentOutline: JSON.stringify(['Opening budget reveal', 'Accommodation breakdown', 'Food tips']),
          trendSignal: null,
          audienceSignal: 'Budget breakdown is top requested topic',
          estimatedScore: 82,
          reasoning: 'Budget content outperforms your average by 2x based on view data.',
        },
      ],
    })
    const page = await DashboardOverviewPage()
    const html = renderToStaticMarkup(page as React.ReactElement)

    expect(html).toContain('Your top video idea right now')
    expect(html).toContain('How I Spent Only $40/Day in Bali')
    expect(html).toContain('Score 82/100')
    expect(html).toContain('See all 4 video ideas')
    expect(html).toContain('What&#x27;s working for you')
    expect(html).toContain('Untapped opportunities')
  })
})
