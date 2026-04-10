/**
 * Tests for GET /api/checkout/subscribe?tierId=&billing=
 *
 * On success the handler returns a 307/302 redirect to the Stripe Checkout URL.
 * Mocks Prisma, Supabase and Stripe — no network or DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock Supabase ──────────────────────────────────────────────────────────────
const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockCreatorFindUnique   = vi.fn()
const mockTierFindUnique      = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockSubscriberCreate    = vi.fn()
const mockRecordApiObservation = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...a: unknown[]) => mockCreatorFindUnique(...a),
    },
    subscriptionTier: {
      findUnique: (...a: unknown[]) => mockTierFindUnique(...a),
    },
    subscriber: {
      findUnique: (...a: unknown[]) => mockSubscriberFindUnique(...a),
      create:     (...a: unknown[]) => mockSubscriberCreate(...a),
    },
  },
}))

vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

// ── Mock Stripe ────────────────────────────────────────────────────────────────
const mockSessionCreate = vi.fn()
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: { create: (...a: unknown[]) => mockSessionCreate(...a) },
    },
  },
}))

import { GET } from '../app/api/checkout/subscribe/route'

// ── Fixtures ───────────────────────────────────────────────────────────────────
const AUTHED_USER = { id: 'user-sub-1', email: 'sub@example.com', user_metadata: {} }
const CREATOR_RECORD = { id: 'creator-1', handle: 'alex', displayName: 'Alex' }
const TIER = {
  id: 'tier-1',
  creatorId: 'creator-1',
  stripePriceId: 'price_monthly_1',
  stripePriceIdYearly: 'price_yearly_1',
  creator: CREATOR_RECORD,
}
const SUBSCRIBER = { id: 'sub-db-1', displayName: 'Alex', stripeCustomerId: null }
const CHECKOUT_URL = 'https://checkout.stripe.com/pay/cs_test_abc123'

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } })
  mockTierFindUnique.mockResolvedValue(TIER)
  mockCreatorFindUnique.mockResolvedValue(null)        // user is NOT a creator by default
  mockSubscriberFindUnique
    .mockResolvedValueOnce({ id: 'sub-db-1', displayName: 'Alex' })  // getOrCreateSubscriber lookup
    .mockResolvedValueOnce(SUBSCRIBER)                                // stripeCustomerId lookup
  mockSubscriberCreate.mockResolvedValue({ id: 'sub-db-1', displayName: 'Alex' })
  mockSessionCreate.mockResolvedValue({ url: CHECKOUT_URL })
  process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000'
})

describe('GET /api/checkout/subscribe', () => {
  it('redirects to /login when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    const res = await GET(req)
    expect(res.status).toBe(307)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/checkout/subscribe', 307, expect.any(Number), 'login_redirect')
    expect(res.headers.get('location')).toContain('/login')
  })

  it('returns 422 when tierId query param is missing', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe')
    const res = await GET(req)
    expect(res.status).toBe(422)
  })

  it('returns 404 when tier is not found or inactive', async () => {
    mockTierFindUnique.mockResolvedValue(null)
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=missing')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns 422 when tier has no stripePriceId', async () => {
    mockTierFindUnique.mockResolvedValue({ ...TIER, stripePriceId: null })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    const res = await GET(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/not yet configured/i)
  })

  it('returns 422 when creator tries to subscribe to their own tier', async () => {
    // The second creator.findUnique call (isOwnCreator) returns a match
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    const res = await GET(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/own tier/i)
  })

  it('creates a Stripe Checkout session with correct price and metadata', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    await GET(req)
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_monthly_1', quantity: 1 }],
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({
            subscriber_id: 'sub-db-1',
            creator_id: 'creator-1',
            tier_id: 'tier-1',
            billing_period: 'monthly',
          }),
        }),
      })
    )
  })

  it('redirects to the Stripe Checkout URL on success', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    const res = await GET(req)
    expect(res.status).toBe(307)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/checkout/subscribe', 307, expect.any(Number), 'stripe_redirect')
    expect(res.headers.get('location')).toBe(CHECKOUT_URL)
  })

  it('uses yearly price when billing=yearly and tier has yearly price', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1&billing=yearly')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.line_items[0].price).toBe('price_yearly_1')
  })

  it('falls back to monthly price when billing=yearly but no yearly price set', async () => {
    mockTierFindUnique.mockResolvedValue({ ...TIER, stripePriceIdYearly: null })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1&billing=yearly')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.line_items[0].price).toBe('price_monthly_1')
  })

  it('passes existing stripeCustomerId to Stripe when subscriber already has one', async () => {
    // Reset and re-queue: first call = getOrCreateSubscriber, second = stripeCustomerId lookup
    mockSubscriberFindUnique.mockReset()
    mockSubscriberFindUnique
      .mockResolvedValueOnce({ id: 'sub-db-1', displayName: 'Alex' })
      .mockResolvedValueOnce({ stripeCustomerId: 'cus_existing_123' })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.customer).toBe('cus_existing_123')
    expect(call.customer_email).toBeUndefined()
  })

  it('passes customer_email when subscriber has no Stripe customer yet', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.customer_email).toBe(AUTHED_USER.email)
    expect(call.customer).toBeUndefined()
  })

  it('includes cancel_url pointing back to subscribe page', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.cancel_url).toContain('/@alex/subscribe')
  })

  it('includes success_url with session_id placeholder', async () => {
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    await GET(req)
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.success_url).toContain('/checkout/success')
    expect(call.success_url).toContain('{CHECKOUT_SESSION_ID}')
  })

  it('returns 500 when Stripe session has no URL', async () => {
    mockSessionCreate.mockResolvedValue({ url: null })
    const req = makeRequest('http://localhost/api/checkout/subscribe?tierId=tier-1')
    const res = await GET(req)
    expect(res.status).toBe(500)
  })
})
