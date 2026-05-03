import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockGetSession = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

const mockCreatorFindUnique = vi.fn()
const mockChannelInsightFindUnique = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    channelInsight: { findUnique: (...args: unknown[]) => mockChannelInsightFindUnique(...args) },
  },
}))

const mockRecordApiObservation = vi.fn()
vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { POST as triggerInsights } from '../app/api/insights/trigger/route'
import { GET as getInsights } from '../app/api/insights/route'

describe('POST /api/insights/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-abc' } } })
    mockRateLimit.mockReturnValue(false)
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' })
    process.env.AI_PIPELINE_URL = 'http://ai.example.com'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'QUEUED', creator_id: 'creator-1' }), { status: 200 }),
    ))
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue(true)
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(429)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(404)
  })

  it('returns 503 when AI_PIPELINE_URL is not configured', async () => {
    delete process.env.AI_PIPELINE_URL
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(503)
  })

  it('returns 401 when session token is missing', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('proxies to FastAPI and returns queued status', async () => {
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'QUEUED' })
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.example.com/api/v1/insights/analyze',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    )
  })

  it('passes through upstream error from FastAPI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Analysis failed' }), { status: 500 }),
    ))
    const res = await triggerInsights(new NextRequest('http://localhost/api/insights/trigger', { method: 'POST' }))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Analysis failed' })
  })
})

describe('GET /api/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' })
    mockChannelInsightFindUnique.mockResolvedValue(null)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await getInsights(new NextRequest('http://localhost/api/insights'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await getInsights(new NextRequest('http://localhost/api/insights'))
    expect(res.status).toBe(404)
  })

  it('returns null insight when no analysis has run', async () => {
    const res = await getInsights(new NextRequest('http://localhost/api/insights'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ insight: null })
  })

  it('returns insight with briefs when analysis is complete', async () => {
    const insight = {
      id: 'insight-1',
      status: 'COMPLETE',
      channelNiche: 'budget travel Asia',
      topPatterns: { top_patterns: ['Budget content outperforms'] },
      audienceDemands: null,
      analyzedVideoCount: 10,
      analyzedAt: null,
      createdAt: null,
      updatedAt: null,
      briefs: [
        {
          id: 'brief-1',
          title: 'Japan on $1500',
          estimatedScore: 82,
          hookIdeas: ['Open with cost reveal'],
          contentOutline: ['Day 1', 'Day 2'],
          trendSignal: null,
          audienceSignal: null,
          reasoning: 'Budget content outperforms.',
          createdAt: null,
        },
      ],
    }
    mockChannelInsightFindUnique.mockResolvedValue(insight)
    const res = await getInsights(new NextRequest('http://localhost/api/insights'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.insight.status).toBe('COMPLETE')
    expect(data.insight.channelNiche).toBe('budget travel Asia')
    expect(data.insight.briefs).toHaveLength(1)
    expect(data.insight.briefs[0].estimatedScore).toBe(82)
  })
})
