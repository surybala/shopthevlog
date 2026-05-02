/**
 * Tests for POST /api/subscriptions/[id]/cancel
 *
 * Sets cancel_at_period_end = true in Stripe so the subscriber retains access
 * until the billing period ends.
 *
 * Mocks Supabase, Prisma and Stripe — no network or DB connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock Supabase ──────────────────────────────────────────────────────────────
const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockSubscriberFindUnique   = vi.fn()
const mockSubscriptionFindUnique = vi.fn()
const mockSubscriptionUpdate     = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    subscriber: {
      findUnique: (...a: unknown[]) => mockSubscriberFindUnique(...a),
    },
    subscription: {
      findUnique: (...a: unknown[]) => mockSubscriptionFindUnique(...a),
      update:     (...a: unknown[]) => mockSubscriptionUpdate(...a),
    },
  },
}))

// ── Mock Stripe ────────────────────────────────────────────────────────────────
const mockSubscriptionsUpdate = vi.fn()
vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { update: (...a: unknown[]) => mockSubscriptionsUpdate(...a) },
  },
}))

import { POST } from '../app/api/subscriptions/[id]/cancel/route'

// ── Fixtures ───────────────────────────────────────────────────────────────────
const AUTHED_USER  = { id: 'user-1', email: 'sub@example.com', user_metadata: {} }
const SUBSCRIBER   = { id: 'sub-db-1' }
const ACTIVE_SUB   = {
  id: 'sub-internal-1',
  subscriberId: 'sub-db-1',
  stripeSubId: 'sub_stripe_1',
  status: 'ACTIVE',
  cancelAtPeriodEnd: false,
}

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/subscriptions/${id}/cancel`, { method: 'POST' })
}

const makeParams = (id: string) => ({ params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } })
  mockSubscriberFindUnique.mockResolvedValue(SUBSCRIBER)
  mockSubscriptionFindUnique.mockResolvedValue(ACTIVE_SUB)
  mockSubscriptionsUpdate.mockResolvedValue({})
  mockSubscriptionUpdate.mockResolvedValue({ ...ACTIVE_SUB, cancelAtPeriodEnd: true })
})

describe('POST /api/subscriptions/[id]/cancel', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when subscriber record does not exist', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/subscriber/i)
  })

  it('returns 404 when subscription does not exist', async () => {
    mockSubscriptionFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when subscription belongs to a different subscriber', async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ ...ACTIVE_SUB, subscriberId: 'someone-else' })
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when subscription is already CANCELED', async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ ...ACTIVE_SUB, status: 'CANCELED' })
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already canceled/i)
  })

  it('returns 409 when cancelAtPeriodEnd is already true', async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ ...ACTIVE_SUB, cancelAtPeriodEnd: true })
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already set to cancel/i)
  })

  it('returns 422 when subscription has no stripeSubId', async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ ...ACTIVE_SUB, stripeSubId: null })
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/stripe/i)
  })

  it('calls stripe.subscriptions.update with cancel_at_period_end=true', async () => {
    await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_stripe_1', {
      cancel_at_period_end: true,
    })
  })

  it('updates cancelAtPeriodEnd to true in DB', async () => {
    await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-internal-1' },
        data: { cancelAtPeriodEnd: true },
      })
    )
  })

  it('returns 200 with the updated subscription on success', async () => {
    const res = await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.subscription.cancelAtPeriodEnd).toBe(true)
  })

  it('calls Stripe before updating DB (Stripe is source of truth)', async () => {
    const callOrder: string[] = []
    mockSubscriptionsUpdate.mockImplementation(async () => { callOrder.push('stripe'); return {} })
    mockSubscriptionUpdate.mockImplementation(async () => { callOrder.push('db'); return ACTIVE_SUB })

    await POST(makeRequest('sub-internal-1'), makeParams('sub-internal-1'))

    expect(callOrder).toEqual(['stripe', 'db'])
  })
})
