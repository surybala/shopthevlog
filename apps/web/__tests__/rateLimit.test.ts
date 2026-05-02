/**
 * Tests for lib/rateLimit.ts
 *
 * Pure TypeScript sliding-window rate limiter — no Next.js dependencies.
 * Uses vi.useFakeTimers() to control time without real delays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import the module fresh for each test suite to get a clean store.
// We re-import inside tests where time manipulation matters.

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the limit', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-allow-${Date.now()}`
    const limited1 = rateLimit(uid, 'test:route', { limit: 3, windowMs: 60_000 })
    const limited2 = rateLimit(uid, 'test:route', { limit: 3, windowMs: 60_000 })
    const limited3 = rateLimit(uid, 'test:route', { limit: 3, windowMs: 60_000 })
    expect(limited1).toBe(false)
    expect(limited2).toBe(false)
    expect(limited3).toBe(false)
  })

  it('blocks the request that exceeds the limit', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-block-${Date.now()}`
    rateLimit(uid, 'test:block', { limit: 2, windowMs: 60_000 })
    rateLimit(uid, 'test:block', { limit: 2, windowMs: 60_000 })
    const limited = rateLimit(uid, 'test:block', { limit: 2, windowMs: 60_000 })
    expect(limited).toBe(true)
  })

  it('different users are tracked independently', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const ts = Date.now()
    const userA = `user-a-${ts}`
    const userB = `user-b-${ts}`
    // Exhaust user A
    rateLimit(userA, 'test:isolation', { limit: 1, windowMs: 60_000 })
    rateLimit(userA, 'test:isolation', { limit: 1, windowMs: 60_000 })

    // User B should still be allowed
    expect(rateLimit(userB, 'test:isolation', { limit: 1, windowMs: 60_000 })).toBe(false)
  })

  it('different routes are tracked independently', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-routes-${Date.now()}`
    // Exhaust route A
    rateLimit(uid, 'route:a', { limit: 1, windowMs: 60_000 })
    rateLimit(uid, 'route:a', { limit: 1, windowMs: 60_000 })

    // Route B unaffected
    expect(rateLimit(uid, 'route:b', { limit: 1, windowMs: 60_000 })).toBe(false)
  })

  it('sliding window drops old timestamps', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-slide-${Date.now()}`
    const route = 'test:slide'

    // Fill up to limit at t=0
    rateLimit(uid, route, { limit: 2, windowMs: 1_000 })
    rateLimit(uid, route, { limit: 2, windowMs: 1_000 })
    // 3rd call at t=0 is blocked
    expect(rateLimit(uid, route, { limit: 2, windowMs: 1_000 })).toBe(true)

    // Advance 2s so the old timestamps fall outside the 1s window
    vi.advanceTimersByTime(2_000)

    // Now should be allowed again
    expect(rateLimit(uid, route, { limit: 2, windowMs: 1_000 })).toBe(false)
  })

  it('limit of 1 allows exactly one request', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-one-${Date.now()}`
    expect(rateLimit(uid, 'test:one', { limit: 1, windowMs: 60_000 })).toBe(false)
    expect(rateLimit(uid, 'test:one', { limit: 1, windowMs: 60_000 })).toBe(true)
  })

  it('high limit allows many requests', async () => {
    const { rateLimit } = await import('../lib/rateLimit')
    const uid = `user-high-${Date.now()}`
    for (let i = 0; i < 100; i++) {
      expect(rateLimit(uid, 'test:high', { limit: 200, windowMs: 60_000 })).toBe(false)
    }
  })
})
