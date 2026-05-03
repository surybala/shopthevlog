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
const mockContentBriefUpdate = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    contentBrief: {
      findUnique: (...args: unknown[]) => mockContentBriefFindUnique(...args),
      update: (...args: unknown[]) => mockContentBriefUpdate(...args),
    },
  },
}))

const mockRecordApiObservation = vi.fn()
vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { PATCH } from '../app/api/insights/briefs/[id]/route'

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/insights/briefs/brief-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

describe('PATCH /api/insights/briefs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' })
    mockContentBriefFindUnique.mockResolvedValue({ id: 'brief-1', creatorId: 'creator-1' })
    mockContentBriefUpdate.mockResolvedValue({
      id: 'brief-1',
      briefStatus: 'FILMING',
      publishedVlogId: null,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await PATCH(makeReq({ briefStatus: 'FILMING' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const res = await PATCH(makeReq({ briefStatus: 'FILMING' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Creator not found' })
  })

  it('returns 400 for invalid briefStatus value', async () => {
    const res = await PATCH(makeReq({ briefStatus: 'INVALID' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/IDEA.*FILMING.*PUBLISHED/)
  })

  it('returns 400 for malformed JSON body', async () => {
    const req = new NextRequest('http://localhost/api/insights/briefs/brief-1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: 'brief-1' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid JSON body' })
  })

  it('returns 404 when brief does not belong to creator', async () => {
    mockContentBriefFindUnique.mockResolvedValue({ id: 'brief-1', creatorId: 'other-creator' })
    const res = await PATCH(makeReq({ briefStatus: 'FILMING' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Brief not found' })
  })

  it('returns 404 when brief does not exist', async () => {
    mockContentBriefFindUnique.mockResolvedValue(null)
    const res = await PATCH(makeReq({ briefStatus: 'FILMING' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(404)
  })

  it('updates status to FILMING', async () => {
    const res = await PATCH(makeReq({ briefStatus: 'FILMING' }), { params: { id: 'brief-1' } })
    expect(res.status).toBe(200)
    expect(mockContentBriefUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'brief-1' },
        data: expect.objectContaining({ briefStatus: 'FILMING' }),
      }),
    )
    const body = await res.json()
    expect(body.brief.briefStatus).toBe('FILMING')
  })

  it('updates status to PUBLISHED with a vlog link', async () => {
    mockContentBriefUpdate.mockResolvedValue({
      id: 'brief-1',
      briefStatus: 'PUBLISHED',
      publishedVlogId: 'vlog-42',
    })
    const res = await PATCH(
      makeReq({ briefStatus: 'PUBLISHED', publishedVlogId: 'vlog-42' }),
      { params: { id: 'brief-1' } },
    )
    expect(res.status).toBe(200)
    expect(mockContentBriefUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ briefStatus: 'PUBLISHED', publishedVlogId: 'vlog-42' }),
      }),
    )
  })

  it('clears publishedVlogId when not a string', async () => {
    mockContentBriefUpdate.mockResolvedValue({
      id: 'brief-1',
      briefStatus: 'IDEA',
      publishedVlogId: null,
    })
    const res = await PATCH(
      makeReq({ briefStatus: 'IDEA', publishedVlogId: 123 }),
      { params: { id: 'brief-1' } },
    )
    expect(res.status).toBe(200)
    expect(mockContentBriefUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedVlogId: null }),
      }),
    )
  })

  it('accepts all three valid statuses', async () => {
    for (const briefStatus of ['IDEA', 'FILMING', 'PUBLISHED'] as const) {
      mockContentBriefUpdate.mockResolvedValue({ id: 'brief-1', briefStatus, publishedVlogId: null })
      const res = await PATCH(makeReq({ briefStatus }), { params: { id: 'brief-1' } })
      expect(res.status).toBe(200)
    }
  })
})
