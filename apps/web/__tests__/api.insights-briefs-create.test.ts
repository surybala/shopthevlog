import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: { getUser: mockGetUser },
  }),
}))

const mockCreatorFindUnique = vi.fn()
const mockChannelInsightFindFirst = vi.fn()
const mockContentBriefCreate = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    channelInsight: { findFirst: (...args: unknown[]) => mockChannelInsightFindFirst(...args) },
    contentBrief: { create: (...args: unknown[]) => mockContentBriefCreate(...args) },
  },
}))

const mockRecordApiObservation = vi.fn()
vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { POST } from '../app/api/insights/briefs/route'

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/insights/briefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CREATOR = { id: 'creator-1' }
const INSIGHT = { id: 'insight-1' }
const BRIEF = {
  id: 'brief-1',
  creatorId: 'creator-1',
  insightId: 'insight-1',
  title: 'Japan on a budget',
  hookIdeas: ['Hook 1'],
  contentOutline: ['Outline 1'],
  reasoning: 'Strong fit for your niche',
  estimatedScore: 75,
  briefStatus: 'FILMING',
}

describe('POST /api/insights/briefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue(CREATOR)
    mockChannelInsightFindFirst.mockResolvedValue(INSIGHT)
    mockContentBriefCreate.mockResolvedValue(BRIEF)
  })

  it('creates a brief with FILMING status and returns 201', async () => {
    const res = await POST(makeRequest({
      title: 'Japan on a budget',
      hookIdeas: ['Hook 1'],
      contentOutline: ['Outline 1'],
      reasoning: 'Strong fit for your niche',
      estimatedScore: 75,
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.brief).toMatchObject({ briefStatus: 'FILMING' })
    expect(mockContentBriefCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creatorId: 'creator-1',
        insightId: 'insight-1',
        title: 'Japan on a budget',
        briefStatus: 'FILMING',
        estimatedScore: 75,
      }),
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeRequest({ title: 'Test' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest({ title: 'Test' }))
    expect(res.status).toBe(404)
  })

  it('returns 422 when creator has no channel insight', async () => {
    mockChannelInsightFindFirst.mockResolvedValue(null)
    const res = await POST(makeRequest({ title: 'Japan on a budget' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/channel analysis/i)
  })

  it('returns 400 when title is missing', async () => {
    const res = await POST(makeRequest({ hookIdeas: [] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/title/i)
  })

  it('returns 400 when title is empty string', async () => {
    const res = await POST(makeRequest({ title: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/insights/briefs', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('defaults hookIdeas and contentOutline to empty arrays when not provided', async () => {
    await POST(makeRequest({ title: 'Minimal brief' }))
    expect(mockContentBriefCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hookIdeas: [],
        contentOutline: [],
      }),
    })
  })

  it('defaults estimatedScore to 50 when not provided', async () => {
    await POST(makeRequest({ title: 'Minimal brief' }))
    expect(mockContentBriefCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ estimatedScore: 50 }),
    })
  })

  it('uses the most recent insight for the creator', async () => {
    await POST(makeRequest({ title: 'Budget Japan' }))
    expect(mockChannelInsightFindFirst).toHaveBeenCalledWith({
      where: { creatorId: 'creator-1' },
      orderBy: { createdAt: 'desc' },
    })
  })
})
