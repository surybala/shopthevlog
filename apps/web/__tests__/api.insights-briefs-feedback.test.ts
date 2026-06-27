import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: { getUser: mockGetUser },
  }),
}))

const mockCreatorFindUnique = vi.fn()
const mockContentBriefFindUnique = vi.fn()
const mockBriefFeedbackCreate = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    contentBrief: { findUnique: (...args: unknown[]) => mockContentBriefFindUnique(...args) },
    briefFeedback: { create: (...args: unknown[]) => mockBriefFeedbackCreate(...args) },
  },
}))

const mockRecordApiObservation = vi.fn()
vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { POST } from '../app/api/insights/briefs/[id]/feedback/route'

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/insights/briefs/brief-1/feedback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

describe('POST /api/insights/briefs/[id]/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' })
    mockContentBriefFindUnique.mockResolvedValue({ id: 'brief-1', creatorId: 'creator-1' })
    mockBriefFeedbackCreate.mockResolvedValue({ id: 'fb-1', action: 'REJECTED' })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq({ action: 'REJECTED' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await POST(makeReq({ action: 'REJECTED' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await POST(makeReq('not-json'), { params: { id: 'brief-1' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid JSON body' })
  })

  it('returns 400 for an invalid action', async () => {
    const res = await POST(makeReq({ action: 'NOPE' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/APPROVED.*EDITED.*REJECTED/)
  })

  it('returns 404 when the brief belongs to another creator', async () => {
    mockContentBriefFindUnique.mockResolvedValue({ id: 'brief-1', creatorId: 'other' })
    const res = await POST(makeReq({ action: 'REJECTED' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(404)
    expect(mockBriefFeedbackCreate).not.toHaveBeenCalled()
  })

  it('records feedback with a trimmed reason', async () => {
    const res = await POST(
      makeReq({ action: 'REJECTED', reason: '  not my niche  ' }),
      { params: { id: 'brief-1' } },
    )
    expect(res.status).toBe(200)
    expect(mockBriefFeedbackCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorId: 'creator-1',
          briefId: 'brief-1',
          action: 'REJECTED',
          reason: 'not my niche',
        }),
      }),
    )
  })

  it('stores null reason when blank', async () => {
    await POST(makeReq({ action: 'APPROVED', reason: '   ' }), { params: { id: 'brief-1' } })
    expect(mockBriefFeedbackCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: null }) }),
    )
  })
})
