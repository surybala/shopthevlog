/**
 * Tests for POST /api/webhooks/stripe
 *
 * The handler verifies Stripe's HMAC signature, then upserts Subscription rows
 * and syncs stripeCustomerId on the Subscriber.
 *
 * Mocks Stripe (constructEvent + subscriptions.retrieve) and Prisma — no
 * network or DB connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock Stripe ────────────────────────────────────────────────────────────────
const mockConstructEvent        = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks:      { constructEvent: (...a: unknown[]) => mockConstructEvent(...a) },
    subscriptions: { retrieve: (...a: unknown[]) => mockSubscriptionsRetrieve(...a) },
  },
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockSubscriberUpdate      = vi.fn()
const mockSubscriptionUpsert    = vi.fn()
const mockSubscriptionUpdateMany = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    subscriber:   { update:     (...a: unknown[]) => mockSubscriberUpdate(...a) },
    subscription: {
      upsert:     (...a: unknown[]) => mockSubscriptionUpsert(...a),
      updateMany: (...a: unknown[]) => mockSubscriptionUpdateMany(...a),
    },
  },
}))

import { POST } from '../app/api/webhooks/stripe/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWebhookRequest(body: object = {}): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'sig_test_123',
    },
    body: JSON.stringify(body),
  })
}

/** Build a minimal Stripe Subscription object with our metadata attached. */
function makeStripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_stripe_1',
    customer: 'cus_abc123',
    status: 'active',
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: {
      subscriber_id: 'sub-db-1',
      creator_id: 'creator-1',
      tier_id: 'tier-1',
      billing_period: 'monthly',
    },
    ...overrides,
  }
}

function makeEvent(type: string, obj: unknown) {
  return { type, data: { object: obj } }
}

// ── Setup / Teardown ───────────────────────────────────────────────────────────

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  mockSubscriberUpdate.mockResolvedValue({})
  mockSubscriptionUpsert.mockResolvedValue({})
  mockSubscriptionUpdateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET
})

// ═══════════════════════════════════════════════════════════════════════════════
// Infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/webhooks/stripe — infrastructure', () => {
  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns 400 when Stripe signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 for unrecognised event types without error', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('some.unknown.event', {}))
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('returns 500 when an event handler throws', async () => {
    // subscriber.update errors are intentionally swallowed; upsert errors are not
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.created', makeStripeSub()))
    mockSubscriptionUpsert.mockRejectedValue(new Error('db failure'))
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// customer.subscription.created
// ═══════════════════════════════════════════════════════════════════════════════

describe('customer.subscription.created', () => {
  it('upserts a Subscription row with ACTIVE status', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.created', makeStripeSub()))
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubId: 'sub_stripe_1' },
        create: expect.objectContaining({ status: 'ACTIVE', subscriberId: 'sub-db-1' }),
        update: expect.objectContaining({ status: 'ACTIVE' }),
      })
    )
  })

  it('stores the Stripe customer ID on the Subscriber', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.created', makeStripeSub()))
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-db-1' },
        data: { stripeCustomerId: 'cus_abc123' },
      })
    )
  })

  it('sets billingPeriod to YEARLY when metadata says yearly', async () => {
    const sub = makeStripeSub({ metadata: { subscriber_id: 'sub-db-1', creator_id: 'c-1', tier_id: 't-1', billing_period: 'yearly' } })
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.created', sub))
    const req = makeWebhookRequest()
    await POST(req)
    const createArg = mockSubscriptionUpsert.mock.calls[0][0].create
    expect(createArg.billingPeriod).toBe('YEARLY')
  })

  it('skips DB writes when subscription has no metadata IDs', async () => {
    const sub = makeStripeSub({ metadata: {} })
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.created', sub))
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled()
  })

  it('maps Stripe "trialing" status to TRIALING', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('customer.subscription.created', makeStripeSub({ status: 'trialing' }))
    )
    const req = makeWebhookRequest()
    await POST(req)
    const createArg = mockSubscriptionUpsert.mock.calls[0][0].create
    expect(createArg.status).toBe('TRIALING')
  })

  it('maps Stripe "past_due" status to PAST_DUE', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('customer.subscription.created', makeStripeSub({ status: 'past_due' }))
    )
    const req = makeWebhookRequest()
    await POST(req)
    const createArg = mockSubscriptionUpsert.mock.calls[0][0].create
    expect(createArg.status).toBe('PAST_DUE')
  })

  it('stores cancelAtPeriodEnd from Stripe', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('customer.subscription.created', makeStripeSub({ cancel_at_period_end: true }))
    )
    const req = makeWebhookRequest()
    await POST(req)
    const createArg = mockSubscriptionUpsert.mock.calls[0][0].create
    expect(createArg.cancelAtPeriodEnd).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// customer.subscription.updated
// ═══════════════════════════════════════════════════════════════════════════════

describe('customer.subscription.updated', () => {
  it('upserts the Subscription with updated status', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSub({ status: 'past_due' }))
    )
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'PAST_DUE' }),
      })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// customer.subscription.deleted
// ═══════════════════════════════════════════════════════════════════════════════

describe('customer.subscription.deleted', () => {
  it('forces status to CANCELED regardless of Stripe status', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('customer.subscription.deleted', makeStripeSub({ status: 'canceled' }))
    )
    const req = makeWebhookRequest()
    await POST(req)
    const createArg = mockSubscriptionUpsert.mock.calls[0][0].create
    const updateArg = mockSubscriptionUpsert.mock.calls[0][0].update
    expect(createArg.status).toBe('CANCELED')
    expect(updateArg.status).toBe('CANCELED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// invoice.payment_succeeded
// ═══════════════════════════════════════════════════════════════════════════════

describe('invoice.payment_succeeded', () => {
  it('retrieves the linked subscription from Stripe and syncs it', async () => {
    const stripeSubFull = makeStripeSub()
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubFull)
    mockConstructEvent.mockReturnValue(
      makeEvent('invoice.payment_succeeded', { subscription: 'sub_stripe_1' })
    )
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_stripe_1')
    expect(mockSubscriptionUpsert).toHaveBeenCalled()
  })

  it('does nothing when invoice has no linked subscription', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('invoice.payment_succeeded', { subscription: null })
    )
    const req = makeWebhookRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// invoice.payment_failed
// ═══════════════════════════════════════════════════════════════════════════════

describe('invoice.payment_failed', () => {
  it('marks subscription as PAST_DUE in the DB', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('invoice.payment_failed', { subscription: 'sub_stripe_1' })
    )
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: { stripeSubId: 'sub_stripe_1' },
      data: { status: 'PAST_DUE' },
    })
  })

  it('does nothing when invoice has no linked subscription', async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent('invoice.payment_failed', { subscription: null })
    )
    const req = makeWebhookRequest()
    await POST(req)
    expect(mockSubscriptionUpdateMany).not.toHaveBeenCalled()
  })
})
