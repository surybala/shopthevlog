import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('platform utility modules', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('rate limits only after the configured threshold within the window', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(0)
    nowSpy.mockReturnValueOnce(100)
    nowSpy.mockReturnValueOnce(200)
    nowSpy.mockReturnValueOnce(700)

    const { rateLimit } = await import('@/lib/rateLimit')

    expect(rateLimit('user-1', 'kits:create', { limit: 2, windowMs: 500 })).toBe(false)
    expect(rateLimit('user-1', 'kits:create', { limit: 2, windowMs: 500 })).toBe(false)
    expect(rateLimit('user-1', 'kits:create', { limit: 2, windowMs: 500 })).toBe(true)
    expect(rateLimit('user-1', 'kits:create', { limit: 2, windowMs: 500 })).toBe(false)
  })

  it('creates a Stripe singleton when the secret is present', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    const stripeConstructor = vi.fn().mockImplementation(function Stripe(this: object, key, options) {
      Object.assign(this, { key, options })
    })

    vi.doMock('stripe', () => ({
      default: stripeConstructor,
    }))

    const { stripe } = await import('@/lib/stripe')

    expect(stripeConstructor).toHaveBeenCalledWith('sk_test_123', {
      apiVersion: '2024-12-18.acacia',
    })
    expect(stripe).toMatchObject({ key: 'sk_test_123' })
  })

  it('throws when the Stripe secret is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY
    vi.doMock('stripe', () => ({
      default: vi.fn(),
    }))

    await expect(import('@/lib/stripe')).rejects.toThrow(/STRIPE_SECRET_KEY/)
  })
})
