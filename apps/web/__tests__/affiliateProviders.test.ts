import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const warnMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('console', { ...console, warn: warnMock })

describe('affiliate provider helpers', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    warnMock.mockReset()
    delete process.env.STAY22_API_KEY
    delete process.env.STAY22_AFFILIATE_ID
    delete process.env.GYG_API_KEY
    delete process.env.GYG_PARTNER_ID
    delete process.env.VIATOR_API_KEY
    delete process.env.VIATOR_MCID
  })

  it('returns null when Stay22 env vars are missing and builds a fallback URL', async () => {
    const { createStay22Link, buildStay22FallbackUrl } = await import('@/lib/affiliates/stay22')

    await expect(
      createStay22Link({ name: 'Hotel Azul', city: 'Lisbon', country: 'Portugal' })
    ).resolves.toBeNull()

    expect(buildStay22FallbackUrl({ name: 'Hotel Azul', city: 'Lisbon', country: 'Portugal' }))
      .toContain('Hotel%20Azul%20Lisbon')
  })

  it('creates a Stay22 affiliate link when the API responds successfully', async () => {
    process.env.STAY22_API_KEY = 'stay22-key'
    process.env.STAY22_AFFILIATE_ID = 'aid-1'
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        affiliate_url: 'https://stay22.example/link',
        link_id: 'link-123',
        hotel_name: 'Hotel Azul',
        city: 'Lisbon',
        country: 'Portugal',
      }),
    })

    const { createStay22Link } = await import('@/lib/affiliates/stay22')

    await expect(
      createStay22Link({ name: 'Hotel Azul', city: 'Lisbon', country: 'Portugal', lat: 1, lng: 2 })
    ).resolves.toEqual({
      affiliateUrl: 'https://stay22.example/link',
      providerProductId: 'link-123',
      hotelName: 'Hotel Azul',
      city: 'Lisbon',
      country: 'Portugal',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null when Stay22 fails', async () => {
    process.env.STAY22_API_KEY = 'stay22-key'
    process.env.STAY22_AFFILIATE_ID = 'aid-1'
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    const { createStay22Link } = await import('@/lib/affiliates/stay22')

    await expect(
      createStay22Link({ name: 'Hotel Azul', city: 'Lisbon', country: 'Portugal' })
    ).resolves.toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })

  it('finds a GetYourGuide activity and builds a fallback URL', async () => {
    process.env.GYG_API_KEY = 'gyg-key'
    process.env.GYG_PARTNER_ID = 'partner-1'
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          tours: [
            { activityId: 42, title: 'Best of Lisbon', url: '/tour/42' },
          ],
        },
      }),
    })

    const { findGYGActivity, buildGYGFallbackUrl } = await import('@/lib/affiliates/gyg')

    await expect(findGYGActivity('Best of', 'Lisbon')).resolves.toEqual({
      affiliateUrl:
        'https://www.getyourguide.com/activity/42/?partner_id=partner-1&utm_medium=online_publisher',
      providerProductId: '42',
      title: 'Best of Lisbon',
    })
    expect(buildGYGFallbackUrl('Best of', 'Lisbon')).toContain('partner_id=partner-1')
  })

  it('returns null when GetYourGuide has no results or errors', async () => {
    process.env.GYG_API_KEY = 'gyg-key'
    process.env.GYG_PARTNER_ID = 'partner-1'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { tours: [] } }),
    })
    fetchMock.mockRejectedValueOnce(new Error('network'))

    const { findGYGActivity } = await import('@/lib/affiliates/gyg')

    await expect(findGYGActivity('Best of', 'Lisbon')).resolves.toBeNull()
    await expect(findGYGActivity('Best of', 'Lisbon')).resolves.toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })

  it('finds a Viator product and builds a fallback URL', async () => {
    process.env.VIATOR_API_KEY = 'viator-key'
    process.env.VIATOR_MCID = 'mcid-1'
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [
          {
            productCode: 'abc',
            title: 'Lisbon Walking Tour',
            webURL: 'https://viator.example/product',
            price: { fromPrice: 99, currency: 'USD' },
          },
        ],
      }),
    })

    const { findViatorProduct, buildViatorFallbackUrl } = await import('@/lib/affiliates/viator')

    await expect(findViatorProduct('Walking Tour', 'Lisbon')).resolves.toEqual({
      affiliateUrl: 'https://viator.example/product?mcid=mcid-1',
      providerProductId: 'abc',
      title: 'Lisbon Walking Tour',
      priceFrom: 'from $99',
    })
    expect(buildViatorFallbackUrl('Walking Tour', 'Lisbon')).toContain('mcid=mcid-1')
  })

  it('returns null when Viator has no results or errors', async () => {
    process.env.VIATOR_API_KEY = 'viator-key'
    process.env.VIATOR_MCID = 'mcid-1'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: [] }),
    })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    const { findViatorProduct } = await import('@/lib/affiliates/viator')

    await expect(findViatorProduct('Walking Tour', 'Lisbon')).resolves.toBeNull()
    await expect(findViatorProduct('Walking Tour', 'Lisbon')).resolves.toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })
})
