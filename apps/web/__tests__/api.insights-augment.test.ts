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
const mockIdeaAugmentationCount = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    ideaAugmentation: { count: (...args: unknown[]) => mockIdeaAugmentationCount(...args) },
  },
}))

const mockRecordApiObservation = vi.fn()
vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { POST } from '../app/api/insights/augment/route'

const AUGMENT_RESULT = {
  id: 'aug-1',
  rawIdea: 'Japan trip on a budget',
  refinedTitles: ['Japan on $1500 (Full Budget Breakdown)', 'The Cheapest Way to Visit Japan'],
  hookConcepts: ['Open with total spend reveal'],
  contentEnhancements: [{ suggestion: 'Add day-by-day cost', why: 'Budget content outperforms', how: 'Track spending daily' }],
  audienceConnections: ['Your audience asks about budget breakdowns constantly'],
  nicheLearnings: ['Top creators lead with the total number in the title'],
  overallAssessment: 'Strong idea that aligns with your top-performing content.',
  confidenceScore: 82,
}

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/insights/augment', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/insights/augment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-abc' } } })
    mockRateLimit.mockReturnValue(false)
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', plan: 'PRO' })
    mockIdeaAugmentationCount.mockResolvedValue(0)
    process.env.AI_PIPELINE_URL = 'http://ai.example.com'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(AUGMENT_RESULT), { status: 200 }),
    ))
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue(true)
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(429)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(404)
  })

  it('returns 503 when AI_PIPELINE_URL is not configured', async () => {
    delete process.env.AI_PIPELINE_URL
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(503)
  })

  it('returns 401 when session token is missing', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/insights/augment', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when idea is too short', async () => {
    const res = await POST(makeReq({ idea: 'short' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/15 char/) })
  })

  it('returns 400 when idea exceeds the max length', async () => {
    const res = await POST(makeReq({ idea: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/under 1000 char/) })
    // Never reaches the AI pipeline
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('returns 400 when idea is missing', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 429 when the daily tier quota is exhausted', async () => {
    // PRO daily limit is 100; pretend they've already used it
    mockIdeaAugmentationCount.mockResolvedValue(100)
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/Idea Workshop runs for today/)
    expect(body.quota).toMatchObject({ limit: 100, remaining: 0 })
    // Quota block happens before spending tokens
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('counts only the current creator usage for today', async () => {
    await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(mockIdeaAugmentationCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creatorId: 'creator-1',
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    )
  })

  it('returns remaining quota alongside a successful augmentation', async () => {
    mockIdeaAugmentationCount.mockResolvedValue(3)
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // PRO limit 100, used 3 before this run → 4 used, 96 left
    expect(data.quota).toMatchObject({ limit: 100, used: 4, remaining: 96 })
  })

  it('proxies to FastAPI with JWT and returns augmentation result', async () => {
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.refinedTitles).toHaveLength(2)
    expect(data.confidenceScore).toBe(82)
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.example.com/api/v1/insights/augment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    )
  })

  it('trims whitespace from idea before forwarding', async () => {
    await POST(makeReq({ idea: '   Japan trip on a budget for 10 days   ' }))
    const fetchMock = vi.mocked(fetch)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.idea).toBe('Japan trip on a budget for 10 days')
  })

  it('passes through upstream error from FastAPI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'AI service unavailable' }), { status: 503 }),
    ))
    const res = await POST(makeReq({ idea: 'Japan trip on a budget for 10 days' }))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'AI service unavailable' })
  })
})
