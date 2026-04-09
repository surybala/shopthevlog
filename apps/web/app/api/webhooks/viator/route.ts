import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma/client'
import { resolveAttributedTripKitId } from '@/lib/affiliateTracking'

// Viator sends booking confirmation webhooks via the Partner API.
// Payload shape:
//   { bookingRef, mcid, productCode, grossAmount, commissionAmount, currency, bookedAt }
// productCode maps to AffiliateLink.providerProductId.
// mcid is our Viator MCID — used to confirm this is our conversion.

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.VIATOR_WEBHOOK_SECRET
  if (!secret) {
    console.error('VIATOR_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-viator-signature') ?? ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: {
    bookingRef: string
    mcid?: string
    productCode: string
    grossAmount: number
    commissionAmount: number
    currency?: string
    bookedAt?: string
  }

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { bookingRef, mcid, productCode, grossAmount, commissionAmount, currency = 'USD', bookedAt } = payload

  if (!bookingRef || !productCode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Confirm this is our MCID to guard against misconfigured webhooks
  const ourMcid = process.env.VIATOR_MCID
  if (ourMcid && mcid && mcid !== ourMcid) {
    return NextResponse.json({ error: 'MCID mismatch' }, { status: 400 })
  }

  // Idempotency
  const existing = await prisma.commission.findUnique({ where: { externalConversionId: bookingRef } })
  if (existing) return NextResponse.json({ ok: true, duplicate: true })

  const link = await prisma.affiliateLink.findFirst({
    where: { providerProductId: productCode, provider: 'VIATOR', isActive: true },
    select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
  })

  if (!link) {
    console.warn(`Viator booking ${bookingRef} for unknown productCode ${productCode}`)
    return NextResponse.json({ ok: true, matched: false })
  }

  const grossCents = Math.round(grossAmount * 100)
  const commissionCents = Math.round(commissionAmount * 100)
  const platformFee = 0
  const creatorEarnings = commissionCents - platformFee
  const attribution = resolveAttributedTripKitId({
    linkedTripKitIds: link.tripKits.map((tripKit) => tripKit.id),
  })

  await prisma.$transaction([
    prisma.commission.create({
      data: {
        creatorId: link.creatorId,
        affiliateLinkId: link.id,
        provider: 'VIATOR',
        externalConversionId: bookingRef,
        grossAmount: grossCents,
        commissionAmount: commissionCents,
        platformFee,
        creatorEarnings,
        currency,
        attributedTripKitId: attribution.tripKitId,
        attributionMethod: attribution.attributionMethod,
        status: 'CONFIRMED',
        convertedAt: bookedAt ? new Date(bookedAt) : new Date(),
      },
    }),
    prisma.affiliateLink.update({
      where: { id: link.id },
      data: {
        conversionCount: { increment: 1 },
        totalEarnings: { increment: creatorEarnings / 100 },
      },
    }),
    ...(attribution.tripKitId
      ? [
          prisma.tripKit.update({
            where: { id: attribution.tripKitId },
            data: {
              conversionCount: { increment: 1 },
              estimatedEarnings: { increment: creatorEarnings / 100 },
            },
          }),
        ]
      : []),
  ])

  return NextResponse.json({ ok: true })
}
