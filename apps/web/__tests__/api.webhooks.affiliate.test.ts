import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

const mockCommissionFindUnique = vi.fn()
const mockAffiliateFindFirst = vi.fn()
const mockCommissionCreate = vi.fn()
const mockAffiliateUpdate = vi.fn()
const mockTripKitUpdate = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    commission: {
      findUnique: (...args: unknown[]) => mockCommissionFindUnique(...args),
      create: (...args: unknown[]) => mockCommissionCreate(...args),
    },
    affiliateLink: {
      findFirst: (...args: unknown[]) => mockAffiliateFindFirst(...args),
      update: (...args: unknown[]) => mockAffiliateUpdate(...args),
    },
    tripKit: {
      update: (...args: unknown[]) => mockTripKitUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

import { POST as stay22Webhook } from '../app/api/webhooks/stay22/route'
import { POST as gygWebhook } from '../app/api/webhooks/gyg/route'
import { POST as viatorWebhook } from '../app/api/webhooks/viator/route'

function signedRequest(url: string, body: Record<string, unknown>, header: string, secret: string) {
  const rawBody = JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [header]: signature,
    },
    body: rawBody,
  })
}

describe('affiliate webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommissionFindUnique.mockResolvedValue(null)
    mockAffiliateFindFirst.mockResolvedValue({ id: 'link-1', creatorId: 'creator-1' })
    mockCommissionCreate.mockResolvedValue({})
    mockAffiliateUpdate.mockResolvedValue({})
    mockTripKitUpdate.mockResolvedValue({})
    mockTransaction.mockImplementation(async (ops) => Promise.all(ops))
    process.env.STAY22_WEBHOOK_SECRET = 'stay22-secret'
    process.env.GYG_WEBHOOK_SECRET = 'gyg-secret'
    process.env.VIATOR_WEBHOOK_SECRET = 'viator-secret'
    process.env.VIATOR_MCID = 'mcid-1'
  })

  it('stores a Stay22 conversion and updates both link and kit metrics', async () => {
    mockAffiliateFindFirst.mockResolvedValueOnce({
      id: 'link-1',
      creatorId: 'creator-1',
      tripKits: [{ id: 'kit-1' }],
    })
    const req = signedRequest(
      'http://localhost/api/webhooks/stay22',
      {
        conversion_id: 'conv-1',
        link_id: 'stay-link-1',
        gross_amount_usd: 125.5,
        commission_usd: 12.75,
        converted_at: '2025-01-01T00:00:00.000Z',
      },
      'x-stay22-signature',
      'stay22-secret'
    )

    const res = await stay22Webhook(req)

    expect(res.status).toBe(200)
    expect(mockCommissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalConversionId: 'conv-1',
          grossAmount: 12550,
          commissionAmount: 1275,
          creatorEarnings: 1275,
          attributedTripKitId: 'kit-1',
          attributionMethod: 'UNIQUE_LINK',
        }),
      })
    )
    expect(mockTripKitUpdate).toHaveBeenCalledWith({
      where: { id: 'kit-1' },
      data: {
        conversionCount: { increment: 1 },
        estimatedEarnings: { increment: 12.75 },
      },
    })
  })

  it('matches GetYourGuide by partner_ref and ignores duplicates', async () => {
    mockAffiliateFindFirst.mockResolvedValueOnce({
      id: 'link-1',
      creatorId: 'creator-1',
      tripKits: [{ id: 'kit-1' }, { id: 'kit-2' }],
    })
    let req = signedRequest(
      'http://localhost/api/webhooks/gyg',
      {
        booking_id: 'booking-1',
        partner_ref: 'SHORT1:kit-2',
        tour_id: 'tour-1',
        gross_amount: 200,
        commission_amount: 30,
      },
      'x-gyg-signature',
      'gyg-secret'
    )
    let res = await gygWebhook(req)
    expect(res.status).toBe(200)
    expect(mockAffiliateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shortCode: 'SHORT1', provider: 'GETYOURGUIDE', isActive: true },
        select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
      })
    )
    expect(mockCommissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributedTripKitId: 'kit-2',
          attributionMethod: 'EXACT_PARTNER_REF',
        }),
      })
    )

    mockCommissionFindUnique.mockResolvedValueOnce({ id: 'existing' })
    req = signedRequest(
      'http://localhost/api/webhooks/gyg',
      {
        booking_id: 'booking-1',
        tour_id: 'tour-1',
        gross_amount: 200,
        commission_amount: 30,
      },
      'x-gyg-signature',
      'gyg-secret'
    )
    res = await gygWebhook(req)
    await expect(res.json()).resolves.toEqual({ ok: true, duplicate: true })
  })

  it('rejects Viator events with an MCID mismatch and updates kits when valid', async () => {
    let req = signedRequest(
      'http://localhost/api/webhooks/viator',
      {
        bookingRef: 'book-1',
        mcid: 'wrong',
        productCode: 'prod-1',
        grossAmount: 300,
        commissionAmount: 45,
      },
      'x-viator-signature',
      'viator-secret'
    )
    let res = await viatorWebhook(req)
    expect(res.status).toBe(400)

    req = signedRequest(
      'http://localhost/api/webhooks/viator',
      {
        bookingRef: 'book-1',
        mcid: 'mcid-1',
        productCode: 'prod-1',
        grossAmount: 300,
        commissionAmount: 45,
      },
      'x-viator-signature',
      'viator-secret'
    )
    mockAffiliateFindFirst.mockResolvedValueOnce({
      id: 'link-1',
      creatorId: 'creator-1',
      tripKits: [{ id: 'kit-1' }, { id: 'kit-2' }],
    })
    res = await viatorWebhook(req)
    expect(res.status).toBe(200)
    expect(mockTripKitUpdate).not.toHaveBeenCalled()
    expect(mockCommissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributedTripKitId: null,
          attributionMethod: null,
        }),
      })
    )
  })
})
