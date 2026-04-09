import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

const mockCreatorFindUnique = vi.fn()
const mockAffiliateFindUnique = vi.fn()
const mockAffiliateCreate = vi.fn()
const mockAffiliateFindMany = vi.fn()
const mockDayActivityUpdate = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    affiliateLink: {
      findUnique: (...args: unknown[]) => mockAffiliateFindUnique(...args),
      create: (...args: unknown[]) => mockAffiliateCreate(...args),
      findMany: (...args: unknown[]) => mockAffiliateFindMany(...args),
    },
    dayActivity: {
      update: (...args: unknown[]) => mockDayActivityUpdate(...args),
    },
  },
}))

const mockCreateStay22Link = vi.fn()
const mockBuildStay22FallbackUrl = vi.fn()
const mockFindGYGActivity = vi.fn()
const mockBuildGYGFallbackUrl = vi.fn()
const mockFindViatorProduct = vi.fn()
const mockBuildViatorFallbackUrl = vi.fn()

vi.mock('@/lib/affiliates/stay22', () => ({
  createStay22Link: (...args: unknown[]) => mockCreateStay22Link(...args),
  buildStay22FallbackUrl: (...args: unknown[]) => mockBuildStay22FallbackUrl(...args),
}))

vi.mock('@/lib/affiliates/gyg', () => ({
  findGYGActivity: (...args: unknown[]) => mockFindGYGActivity(...args),
  buildGYGFallbackUrl: (...args: unknown[]) => mockBuildGYGFallbackUrl(...args),
}))

vi.mock('@/lib/affiliates/viator', () => ({
  findViatorProduct: (...args: unknown[]) => mockFindViatorProduct(...args),
  buildViatorFallbackUrl: (...args: unknown[]) => mockBuildViatorFallbackUrl(...args),
}))

import { GET as listLinks, POST as createLink } from '../app/api/affiliate-links/route'
import { POST as resolveLink } from '../app/api/affiliate-links/resolve/route'

describe('affiliate link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockRateLimit.mockReturnValue(false)
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockAffiliateFindUnique.mockResolvedValue(null)
    mockAffiliateCreate.mockImplementation(async ({ data }) => ({
      id: 'link-1',
      ...data,
    }))
    mockAffiliateFindMany.mockResolvedValue([{ id: 'link-1', targetName: 'Hotel Azul' }])
    mockDayActivityUpdate.mockResolvedValue({})
    mockCreateStay22Link.mockResolvedValue(null)
    mockBuildStay22FallbackUrl.mockReturnValue('https://stay22.example/search')
    mockFindGYGActivity.mockResolvedValue(null)
    mockBuildGYGFallbackUrl.mockReturnValue('https://gyg.example/search')
    mockFindViatorProduct.mockResolvedValue(null)
    mockBuildViatorFallbackUrl.mockReturnValue('https://viator.example/search')
  })

  it('lists affiliate links for the signed-in creator', async () => {
    const res = await listLinks(new NextRequest('http://localhost/api/affiliate-links?q=hotel'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ links: [{ id: 'link-1', targetName: 'Hotel Azul' }] })
    expect(mockAffiliateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creatorId: 'creator-1',
          isActive: true,
          targetName: { contains: 'hotel', mode: 'insensitive' },
        }),
      })
    )
  })

  it('creates a manual affiliate link with detected provider metadata', async () => {
    const res = await createLink(
      new NextRequest('http://localhost/api/affiliate-links', {
        method: 'POST',
        body: JSON.stringify({
          targetName: 'Hotel Azul',
          targetUrl: 'https://booking.com/hotel-azul',
          activityType: 'ACCOMMODATION',
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorId: 'creator-1',
          provider: 'BOOKING_COM',
          type: 'HOTEL',
          targetName: 'Hotel Azul',
        }),
      })
    )
  })

  it('returns validation errors for malformed manual affiliate requests', async () => {
    const res = await createLink(
      new NextRequest('http://localhost/api/affiliate-links', {
        method: 'POST',
        body: JSON.stringify({ targetName: '', targetUrl: 'not-a-url' }),
      })
    )

    expect(res.status).toBe(422)
  })

  it('resolves accommodations through Stay22 fallback when provider lookup misses', async () => {
    const res = await resolveLink(
      new NextRequest('http://localhost/api/affiliate-links/resolve', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Hotel Azul',
          city: 'Lisbon',
          country: 'Portugal',
          type: 'accommodation',
          kitId: 'kit-1',
          activityId: 'act-1',
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(mockCreateStay22Link).toHaveBeenCalled()
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'STAY22',
          affiliateUrl: 'https://stay22.example/search',
          tripKits: { connect: { id: 'kit-1' } },
        }),
      })
    )
    expect(mockDayActivityUpdate).toHaveBeenCalledWith({
      where: { id: 'act-1' },
      data: { affiliateLinkId: 'link-1' },
    })
  })

  it('resolves experiences through GetYourGuide when available', async () => {
    mockFindGYGActivity.mockResolvedValue({
      affiliateUrl: 'https://gyg.example/activity',
      providerProductId: 'gyg-1',
      title: 'Lisbon Tour',
    })

    const res = await resolveLink(
      new NextRequest('http://localhost/api/affiliate-links/resolve', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Lisbon Tour',
          city: 'Lisbon',
          type: 'experience',
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'GETYOURGUIDE',
          providerProductId: 'gyg-1',
        }),
      })
    )
  })

  it('falls back to Viator and flight search when needed', async () => {
    mockFindViatorProduct.mockResolvedValue({
      affiliateUrl: 'https://viator.example/product',
      providerProductId: 'via-1',
      title: 'Sunset Cruise',
      priceFrom: 'from $88',
    })

    let res = await resolveLink(
      new NextRequest('http://localhost/api/affiliate-links/resolve', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Sunset Cruise',
          city: 'Lisbon',
          type: 'tour',
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'VIATOR',
          providerProductId: 'via-1',
          priceFrom: 'from $88',
        }),
      })
    )

    process.env.SKYSCANNER_AFFILIATE_ID = 'sky-1'
    res = await resolveLink(
      new NextRequest('http://localhost/api/affiliate-links/resolve', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Flight to Lisbon',
          city: 'Lisbon',
          type: 'flight',
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(mockAffiliateCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'SKYSCANNER',
          type: 'FLIGHT_SEARCH',
        }),
      })
    )
  })

  it('returns 422 for unsupported resolve types', async () => {
    const res = await resolveLink(
      new NextRequest('http://localhost/api/affiliate-links/resolve', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Mystery Link',
          city: 'Lisbon',
          type: 'other',
        }),
      })
    )

    expect(res.status).toBe(422)
  })
})
