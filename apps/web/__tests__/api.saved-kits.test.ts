/**
 * Tests for POST/DELETE/GET /api/account/saved-kits
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
const mockTripKitFindUnique = vi.fn()
const mockTripKitUpdate = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockSubscriberCreate = vi.fn()
const mockSavedKitUpsert = vi.fn()
const mockSavedKitDeleteMany = vi.fn()
const mockSavedKitFindMany = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    tripKit:    {
      findUnique: (...a: unknown[]) => mockTripKitFindUnique(...a),
      update:     (...a: unknown[]) => mockTripKitUpdate(...a),
    },
    subscriber: {
      findUnique: (...a: unknown[]) => mockSubscriberFindUnique(...a),
      create:     (...a: unknown[]) => mockSubscriberCreate(...a),
    },
    savedKit: {
      upsert:     (...a: unknown[]) => mockSavedKitUpsert(...a),
      deleteMany: (...a: unknown[]) => mockSavedKitDeleteMany(...a),
      findMany:   (...a: unknown[]) => mockSavedKitFindMany(...a),
    },
  },
}))

vi.mock('@/lib/rateLimit', () => ({ rateLimit: () => false }))

import { POST, DELETE, GET } from '../app/api/account/saved-kits/route'

const AUTHED_USER = { id: 'user-1', email: 'test@example.com', user_metadata: {} }
const SUBSCRIBER = { id: 'sub-1', displayName: 'Test' }
const KIT = { id: 'kit-1', isPublished: true }

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } })
  mockTripKitFindUnique.mockResolvedValue(KIT)
  mockTripKitUpdate.mockResolvedValue({})
  mockSubscriberFindUnique.mockResolvedValue(SUBSCRIBER)
  mockSubscriberCreate.mockResolvedValue(SUBSCRIBER)
  mockSavedKitUpsert.mockResolvedValue({})
  mockSavedKitDeleteMany.mockResolvedValue({ count: 1 })
  mockSavedKitFindMany.mockResolvedValue([])
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/account/saved-kits', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', { kitId: 'kit-1' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 422 when kitId is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', {})
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 404 when kit does not exist', async () => {
    mockTripKitFindUnique.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', { kitId: 'ghost' })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 404 when kit is not published', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', isPublished: false })
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', { kitId: 'kit-1' })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('saves kit and returns { saved: true }', async () => {
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', { kitId: 'kit-1' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ saved: true })
    expect(mockSavedKitUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriberId_tripKitId: { subscriberId: SUBSCRIBER.id, tripKitId: 'kit-1' } },
      }),
    )
  })

  it('auto-creates subscriber when none exists', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/account/saved-kits', { kitId: 'kit-1' })
    await POST(req)
    expect(mockSubscriberCreate).toHaveBeenCalled()
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/account/saved-kits', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('DELETE', 'http://localhost/api/account/saved-kits?kitId=kit-1')
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })

  it('returns 422 when kitId query param is missing', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/account/saved-kits')
    const res = await DELETE(req)
    expect(res.status).toBe(422)
  })

  it('returns { saved: false } when subscriber does not exist', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const req = makeRequest('DELETE', 'http://localhost/api/account/saved-kits?kitId=kit-1')
    const res = await DELETE(req)
    const body = await res.json()
    expect(body).toEqual({ saved: false })
    expect(mockSavedKitDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes saved kit and returns { saved: false }', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/account/saved-kits?kitId=kit-1')
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ saved: false })
    expect(mockSavedKitDeleteMany).toHaveBeenCalledWith({
      where: { subscriberId: SUBSCRIBER.id, tripKitId: 'kit-1' },
    })
  })
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/account/saved-kits', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('GET', 'http://localhost/api/account/saved-kits')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns empty array when subscriber does not exist', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const req = makeRequest('GET', 'http://localhost/api/account/saved-kits')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ savedKits: [] })
    expect(mockSavedKitFindMany).not.toHaveBeenCalled()
  })

  it('returns list of saved kits', async () => {
    const fakeKit = {
      id: 'kit-1', title: 'Japan trip', slug: 'japan', coverImageUrl: null,
      primaryCity: 'Tokyo', countries: ['Japan'], durationDays: 10,
      accessTier: 'FREE', estimatedBudgetLow: 1500,
      creator: { handle: 'alex', displayName: 'Alex', avatarUrl: null },
    }
    mockSavedKitFindMany.mockResolvedValue([
      { savedAt: new Date('2026-01-01'), tripKit: fakeKit },
    ])

    const req = makeRequest('GET', 'http://localhost/api/account/saved-kits')
    const res = await GET(req)
    const body = await res.json()
    expect(body.savedKits).toHaveLength(1)
    expect(body.savedKits[0].title).toBe('Japan trip')
  })
})
