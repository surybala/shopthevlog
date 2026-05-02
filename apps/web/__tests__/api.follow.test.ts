/**
 * Tests for POST/DELETE/GET /api/account/follow
 *
 * Mocks Prisma and Supabase — no network or DB connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock Supabase ──────────────────────────────────────────────────────────────
const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockCreatorFindUnique = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockFollowFindUnique = vi.fn()
const mockFollowUpsert = vi.fn()
const mockFollowDeleteMany = vi.fn()
const mockSubscriberCreate = vi.fn()
const mockRecordApiObservation = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator:    { findUnique: (...a: unknown[]) => mockCreatorFindUnique(...a) },
    subscriber: {
      findUnique: (...a: unknown[]) => mockSubscriberFindUnique(...a),
      create:     (...a: unknown[]) => mockSubscriberCreate(...a),
    },
    follow: {
      findUnique:  (...a: unknown[]) => mockFollowFindUnique(...a),
      upsert:      (...a: unknown[]) => mockFollowUpsert(...a),
      deleteMany:  (...a: unknown[]) => mockFollowDeleteMany(...a),
    },
  },
}))

vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

// ── Mock rate limiter (always pass) ───────────────────────────────────────────
vi.mock('@/lib/rateLimit', () => ({ rateLimit: () => false }))

import { POST, DELETE, GET } from '../app/api/account/follow/route'

const AUTHED_USER = { id: 'user-1', email: 'test@example.com', user_metadata: {} }
const CREATOR = { id: 'creator-1', isPublished: true }
const SUBSCRIBER = { id: 'sub-1', displayName: 'Test' }

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER }, error: null })
  mockCreatorFindUnique.mockResolvedValue(CREATOR)
  mockSubscriberFindUnique.mockResolvedValue(SUBSCRIBER)
  mockSubscriberCreate.mockResolvedValue(SUBSCRIBER)
  mockFollowUpsert.mockResolvedValue({})
  mockFollowDeleteMany.mockResolvedValue({ count: 1 })
  mockFollowFindUnique.mockResolvedValue({ id: 'follow-1' })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/account/follow', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'alex' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/account/follow', 401, expect.any(Number), 'unauthorized')
  })

  it('returns 422 when creatorHandle is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/account/follow', {})
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when creatorHandle is too long', async () => {
    const req = makeRequest('POST', 'http://localhost/api/account/follow', {
      creatorHandle: 'a'.repeat(31),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 404 when creator does not exist', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'ghost' })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 404 when creator is not published', async () => {
    mockCreatorFindUnique.mockResolvedValue({ id: 'c-1', isPublished: false })
    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'draft' })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 422 when user tries to follow themselves', async () => {
    // First call: published creator lookup; second call: own creator lookup
    mockCreatorFindUnique
      .mockResolvedValueOnce({ id: 'creator-1', isPublished: true })
      .mockResolvedValueOnce({ id: 'creator-1' })

    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'self' })
    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/yourself/i)
  })

  it('creates follow and returns { following: true }', async () => {
    // Own creator lookup returns different id (not self-follow)
    mockCreatorFindUnique
      .mockResolvedValueOnce({ id: 'creator-1', isPublished: true })
      .mockResolvedValueOnce({ id: 'creator-2' }) // viewer's own creator

    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'alex' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/account/follow', 200, expect.any(Number), 'following_created')
    const body = await res.json()
    expect(body).toEqual({ following: true })
    expect(mockFollowUpsert).toHaveBeenCalled()
  })

  it('auto-creates subscriber when none exists', async () => {
    mockCreatorFindUnique
      .mockResolvedValueOnce({ id: 'creator-1', isPublished: true })
      .mockResolvedValueOnce(null) // no own creator
    mockSubscriberFindUnique.mockResolvedValue(null)

    const req = makeRequest('POST', 'http://localhost/api/account/follow', { creatorHandle: 'alex' })
    await POST(req)
    expect(mockSubscriberCreate).toHaveBeenCalled()
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/account/follow', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('DELETE', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })

  it('returns 422 when creatorHandle query param missing', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/account/follow')
    const res = await DELETE(req)
    expect(res.status).toBe(422)
  })

  it('returns 404 when creator does not exist', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('DELETE', 'http://localhost/api/account/follow?creatorHandle=ghost')
    const res = await DELETE(req)
    expect(res.status).toBe(404)
  })

  it('returns { following: false } when subscriber record not found', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const req = makeRequest('DELETE', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ following: false })
    expect(mockFollowDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes follow and returns { following: false }', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ following: false })
    expect(mockFollowDeleteMany).toHaveBeenCalledWith({
      where: { subscriberId: SUBSCRIBER.id, creatorId: CREATOR.id },
    })
  })
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/account/follow', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('GET', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 422 when creatorHandle missing', async () => {
    const req = makeRequest('GET', 'http://localhost/api/account/follow')
    const res = await GET(req)
    expect(res.status).toBe(422)
  })

  it('returns { following: false } when creator not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('GET', 'http://localhost/api/account/follow?creatorHandle=ghost')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ following: false })
  })

  it('returns { following: false } when subscriber not found', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const req = makeRequest('GET', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ following: false })
  })

  it('returns { following: false } when follow record absent', async () => {
    mockFollowFindUnique.mockResolvedValue(null)
    const req = makeRequest('GET', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ following: false })
  })

  it('returns { following: true } when follow record exists', async () => {
    mockFollowFindUnique.mockResolvedValue({ id: 'f-1' })
    const req = makeRequest('GET', 'http://localhost/api/account/follow?creatorHandle=alex')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ following: true })
  })
})
