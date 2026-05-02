import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

const mockAffiliateFindUnique = vi.fn()
const mockSubscriberFindUnique = vi.fn()
const mockClickEventCreate = vi.fn()
const mockAffiliateUpdate = vi.fn()
const mockTripKitUpdateMany = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    affiliateLink: {
      findUnique: (...args: unknown[]) => mockAffiliateFindUnique(...args),
      update: (...args: unknown[]) => mockAffiliateUpdate(...args),
    },
    subscriber: {
      findUnique: (...args: unknown[]) => mockSubscriberFindUnique(...args),
    },
    clickEvent: {
      create: (...args: unknown[]) => mockClickEventCreate(...args),
    },
    tripKit: {
      updateMany: (...args: unknown[]) => mockTripKitUpdateMany(...args),
    },
  },
}))

import { GET } from '../app/r/r/[shortCode]/route'

describe('affiliate redirect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockAffiliateFindUnique.mockResolvedValue({
      id: 'link-1',
      creatorId: 'creator-1',
      isActive: true,
      provider: 'GETYOURGUIDE',
      affiliateUrl: 'https://gyg.example/fallback',
      targetUrl: 'https://gyg.example/fallback',
      providerProductId: 'tour-1',
    })
    mockSubscriberFindUnique.mockResolvedValue({ id: 'subscriber-1' })
    mockClickEventCreate.mockResolvedValue({})
    mockAffiliateUpdate.mockResolvedValue({})
    mockTripKitUpdateMany.mockResolvedValue({ count: 1 })
    process.env.GYG_PARTNER_ID = 'partner-1'
  })

  it('redirects to 404 when the link is missing or inactive', async () => {
    mockAffiliateFindUnique.mockResolvedValueOnce(null)
    let res = await GET(new NextRequest('http://localhost/r/r/ABC123'), { params: { shortCode: 'ABC123' } })
    expect(res.headers.get('location')).toBe('http://localhost/404')

    mockAffiliateFindUnique.mockResolvedValueOnce({ isActive: false })
    res = await GET(new NextRequest('http://localhost/r/r/ABC123'), { params: { shortCode: 'ABC123' } })
    expect(res.headers.get('location')).toBe('http://localhost/404')
  })

  it('records click details, increments metrics, and sets a session cookie', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('session-1')

    const req = new NextRequest('http://localhost/r/r/ABC123?kit=kit-1', {
      headers: {
        referer: 'https://example.com/post',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
      },
    })
    const res = await GET(req, { params: { shortCode: 'ABC123' } })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('partner_id=partner-1')
    await vi.waitFor(() => {
      expect(mockClickEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'session-1',
            subscriberId: 'subscriber-1',
            tripKitId: 'kit-1',
            referrer: 'https://example.com/post',
            device: 'MOBILE',
          }),
        })
      )
    })
    expect(mockTripKitUpdateMany).toHaveBeenCalledWith({
      where: { id: 'kit-1', affiliateLinks: { some: { id: 'link-1' } } },
      data: { clickCount: { increment: 1 } },
    })
    expect(res.cookies.get('vs_session')?.value).toBe('session-1')
  })

  it('reuses an existing session cookie and falls back to all linked kits when no kit is supplied', async () => {
    const req = new NextRequest('http://localhost/r/r/ABC123', {
      headers: {
        cookie: 'vs_session=session-existing',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    })

    const res = await GET(req, { params: { shortCode: 'ABC123' } })

    expect(res.cookies.get('vs_session')).toBeUndefined()
    await vi.waitFor(() => {
      expect(mockClickEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'session-existing',
            device: 'DESKTOP',
          }),
        })
      )
    })
    expect(mockTripKitUpdateMany).toHaveBeenCalledWith({
      where: { affiliateLinks: { some: { id: 'link-1' } } },
      data: { clickCount: { increment: 1 } },
    })
  })
})
