/**
 * Tests for:
 *   GET  /api/tiers               — list a creator's active tiers (public)
 *   POST /api/tiers               — create tier + Stripe Product/Price (creator only)
 *   PATCH  /api/tiers/[id]        — update name/description/perks/kitAccess
 *   DELETE /api/tiers/[id]        — deactivate tier, archive Stripe prices
 *
 * Mocks Prisma, Supabase and Stripe — no network or DB connection.
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
const mockTierFindMany     = vi.fn()
const mockTierFindFirst    = vi.fn()
const mockTierFindUnique   = vi.fn()
const mockTierCreate       = vi.fn()
const mockTierUpdate       = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...a: unknown[]) => mockCreatorFindUnique(...a),
    },
    subscriptionTier: {
      findMany:   (...a: unknown[]) => mockTierFindMany(...a),
      findFirst:  (...a: unknown[]) => mockTierFindFirst(...a),
      findUnique: (...a: unknown[]) => mockTierFindUnique(...a),
      create:     (...a: unknown[]) => mockTierCreate(...a),
      update:     (...a: unknown[]) => mockTierUpdate(...a),
    },
  },
}))

// ── Mock Stripe ────────────────────────────────────────────────────────────────
const mockProductsCreate = vi.fn()
const mockPricesCreate   = vi.fn()
const mockPricesUpdate   = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    products: { create: (...a: unknown[]) => mockProductsCreate(...a) },
    prices:   {
      create: (...a: unknown[]) => mockPricesCreate(...a),
      update: (...a: unknown[]) => mockPricesUpdate(...a),
    },
  },
}))

// ── Mock rate limiter ──────────────────────────────────────────────────────────
const mockRateLimit = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }))

import { GET, POST } from '../app/api/tiers/route'
import { PATCH, DELETE } from '../app/api/tiers/[id]/route'

// ── Fixtures ───────────────────────────────────────────────────────────────────
const AUTHED_USER = { id: 'user-1', email: 'creator@example.com', user_metadata: {} }
const CREATOR     = { id: 'creator-1', displayName: 'Alex Wanders', defaultCurrency: 'USD' }
const TIER = {
  id: 'tier-1',
  creatorId: 'creator-1',
  name: 'Explorer',
  monthlyPrice: 900,
  yearlyPrice: null,
  description: 'All access',
  perks: ['All Trip Kits'],
  kitAccess: 'PREMIUM',
  isActive: true,
  stripePriceId: 'price_monthly_1',
  stripePriceIdYearly: null,
  _count: { subscriptions: 0 },
}

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockReturnValue(false)          // allow by default
  mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } })
  mockCreatorFindUnique.mockResolvedValue(CREATOR)
  mockTierFindMany.mockResolvedValue([TIER])
  mockTierFindFirst.mockResolvedValue(null)      // no existing tier → sortOrder 0
  mockTierFindUnique.mockResolvedValue(TIER)
  mockTierCreate.mockResolvedValue(TIER)
  mockTierUpdate.mockResolvedValue({ ...TIER, isActive: false })
  mockProductsCreate.mockResolvedValue({ id: 'prod_test' })
  mockPricesCreate.mockResolvedValue({ id: 'price_test' })
  mockPricesUpdate.mockResolvedValue({ id: 'price_test', active: false })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/tiers
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/tiers', () => {
  it('returns 422 when creatorId is missing', async () => {
    const req = makeRequest('GET', 'http://localhost/api/tiers')
    const res = await GET(req)
    expect(res.status).toBe(422)
  })

  it('returns the list of active tiers for a creator', async () => {
    const req = makeRequest('GET', 'http://localhost/api/tiers?creatorId=creator-1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tiers).toHaveLength(1)
    expect(body.tiers[0].id).toBe('tier-1')
  })

  it('returns an empty array when creator has no tiers', async () => {
    mockTierFindMany.mockResolvedValue([])
    const req = makeRequest('GET', 'http://localhost/api/tiers?creatorId=creator-1')
    const res = await GET(req)
    const body = await res.json()
    expect(body.tiers).toEqual([])
  })

  it('queries by creatorId and isActive=true', async () => {
    const req = makeRequest('GET', 'http://localhost/api/tiers?creatorId=creator-abc')
    await GET(req)
    expect(mockTierFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { creatorId: 'creator-abc', isActive: true },
      })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/tiers
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/tiers', () => {
  const VALID_BODY = {
    name: 'Explorer',
    monthlyPrice: 900,
    description: 'All access',
    perks: ['All Trip Kits'],
    kitAccess: 'PREMIUM',
  }

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    mockRateLimit.mockReturnValueOnce(true)
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(429)
  })

  it('returns 404 when creator profile does not exist', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 422 when name is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      name: '',
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when monthlyPrice is missing', async () => {
    const { name, ...rest } = VALID_BODY
    const req = makeRequest('POST', 'http://localhost/api/tiers', { name, ...rest, monthlyPrice: undefined })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when monthlyPrice is below 100 cents', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      monthlyPrice: 50,
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when monthlyPrice exceeds maximum', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      monthlyPrice: 200_000,
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when kitAccess is not a valid enum value', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      kitAccess: 'SUPERUSER',
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('creates Stripe Product on success', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    expect(mockProductsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('Explorer'),
        metadata: expect.objectContaining({ creator_id: CREATOR.id }),
      })
    )
  })

  it('creates monthly Stripe Price', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_amount: 900,
        currency: 'usd',
        recurring: { interval: 'month' },
      })
    )
  })

  it('also creates yearly Stripe Price when yearlyPrice provided', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      yearlyPrice: 8000,
    })
    await POST(req)
    expect(mockPricesCreate).toHaveBeenCalledTimes(2)
    const yearlyCall = mockPricesCreate.mock.calls[1][0]
    expect(yearlyCall.unit_amount).toBe(8000)
    expect(yearlyCall.recurring.interval).toBe('year')
  })

  it('skips yearly Price when yearlyPrice is not provided', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    expect(mockPricesCreate).toHaveBeenCalledTimes(1)
  })

  it('returns 201 with created tier on success', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.tier.id).toBe('tier-1')
  })

  it('persists stripePriceId from Stripe in the DB record', async () => {
    mockPricesCreate.mockResolvedValue({ id: 'price_monthly_xyz' })
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    const createCall = mockTierCreate.mock.calls[0][0]
    expect(createCall.data.stripePriceId).toBe('price_monthly_xyz')
  })

  it('truncates perks array to 10 items', async () => {
    const req = makeRequest('POST', 'http://localhost/api/tiers', {
      ...VALID_BODY,
      perks: Array.from({ length: 15 }, (_, i) => `Perk ${i}`),
    })
    await POST(req)
    const createCall = mockTierCreate.mock.calls[0][0]
    expect(createCall.data.perks).toHaveLength(10)
  })

  it('defaults kitAccess to FREE when not provided', async () => {
    const { kitAccess, ...bodyWithoutKitAccess } = VALID_BODY
    const req = makeRequest('POST', 'http://localhost/api/tiers', bodyWithoutKitAccess)
    await POST(req)
    const createCall = mockTierCreate.mock.calls[0][0]
    expect(createCall.data.kitAccess).toBe('FREE')
  })

  it('assigns sortOrder 0 for the first tier', async () => {
    mockTierFindFirst.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    const createCall = mockTierCreate.mock.calls[0][0]
    expect(createCall.data.sortOrder).toBe(0)
  })

  it('increments sortOrder based on existing max', async () => {
    mockTierFindFirst.mockResolvedValue({ sortOrder: 2 })
    const req = makeRequest('POST', 'http://localhost/api/tiers', VALID_BODY)
    await POST(req)
    const createCall = mockTierCreate.mock.calls[0][0]
    expect(createCall.data.sortOrder).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/tiers/[id]
// ═══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/tiers/[id]', () => {
  const params = { params: { id: 'tier-1' } }

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'New name' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator profile not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'X' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(404)
  })

  it('returns 404 when tier does not belong to the creator', async () => {
    mockTierFindUnique.mockResolvedValue({ ...TIER, creatorId: 'someone-else' })
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'X' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(404)
  })

  it('returns 404 when tier does not exist', async () => {
    mockTierFindUnique.mockResolvedValue(null)
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'X' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(404)
  })

  it('returns 422 when kitAccess value is invalid', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { kitAccess: 'INVALID' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(422)
  })

  it('returns 200 with updated tier on success', async () => {
    mockTierUpdate.mockResolvedValue({ ...TIER, name: 'VIP' })
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'VIP' })
    const res = await PATCH(req, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tier.name).toBe('VIP')
  })

  it('updates name, description, perks and kitAccess via Prisma', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', {
      name: 'Gold',
      description: 'Gold tier',
      perks: ['Perk A'],
      kitAccess: 'FOLLOWER',
    })
    await PATCH(req, params)
    const updateCall = mockTierUpdate.mock.calls[0][0]
    expect(updateCall.data).toMatchObject({
      name: 'Gold',
      description: 'Gold tier',
      perks: ['Perk A'],
      kitAccess: 'FOLLOWER',
    })
  })

  it('does not call Stripe when editing name/description', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/tiers/tier-1', { name: 'Renamed' })
    await PATCH(req, params)
    expect(mockPricesUpdate).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/tiers/[id]
// ═══════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/tiers/[id]', () => {
  const params = { params: { id: 'tier-1' } }

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    const res = await DELETE(req, params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when creator profile not found', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    const res = await DELETE(req, params)
    expect(res.status).toBe(404)
  })

  it('returns 404 when tier does not belong to creator', async () => {
    mockTierFindUnique.mockResolvedValue({ ...TIER, creatorId: 'other', _count: { subscriptions: 0 } })
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    const res = await DELETE(req, params)
    expect(res.status).toBe(404)
  })

  it('returns 409 when tier has active subscribers', async () => {
    mockTierFindUnique.mockResolvedValue({ ...TIER, _count: { subscriptions: 3 } })
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    const res = await DELETE(req, params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/active subscriber/i)
  })

  it('archives Stripe monthly price', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    await DELETE(req, params)
    expect(mockPricesUpdate).toHaveBeenCalledWith('price_monthly_1', { active: false })
  })

  it('archives Stripe yearly price when present', async () => {
    mockTierFindUnique.mockResolvedValue({
      ...TIER,
      stripePriceIdYearly: 'price_yearly_1',
      _count: { subscriptions: 0 },
    })
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    await DELETE(req, params)
    expect(mockPricesUpdate).toHaveBeenCalledWith('price_yearly_1', { active: false })
  })

  it('marks tier as inactive in DB', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    await DELETE(req, params)
    expect(mockTierUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    )
  })

  it('returns { deactivated: true } on success', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/tiers/tier-1')
    const res = await DELETE(req, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ deactivated: true })
  })
})
