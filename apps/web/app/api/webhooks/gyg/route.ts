import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma/client'
import { parseAffiliatePartnerRef, resolveAttributedTripKitId } from '@/lib/affiliateTracking'

// GetYourGuide sends a booking confirmation webhook when a tour is booked.
// Payload shape:
//   { booking_id, partner_ref, tour_id, gross_amount, commission_amount, currency, booked_at }
// partner_ref is the value we pass as `partner_reference` when constructing the GYG link.
// tour_id maps to AffiliateLink.providerProductId.

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.GYG_WEBHOOK_SECRET
  if (!secret) {
    console.error('GYG_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-gyg-signature') ?? ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: {
    booking_id: string
    partner_ref?: string
    tour_id: string
    gross_amount: number
    commission_amount: number
    currency?: string
    booked_at?: string
  }

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { booking_id, partner_ref, tour_id, gross_amount, commission_amount, currency = 'USD', booked_at } = payload
  const parsedPartnerRef = parseAffiliatePartnerRef(partner_ref)

  if (!booking_id || !tour_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Idempotency
  const existing = await prisma.commission.findUnique({ where: { externalConversionId: booking_id } })
  if (existing) return NextResponse.json({ ok: true, duplicate: true })

  // Try partner_ref (our shortCode embedded in the link) first, then fall back to tour_id
  let link = partner_ref
    ? await prisma.affiliateLink.findFirst({
        where: { shortCode: parsedPartnerRef.shortCode ?? partner_ref, provider: 'GETYOURGUIDE', isActive: true },
        select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
      })
    : null

  if (!link) {
    link = await prisma.affiliateLink.findFirst({
      where: { providerProductId: tour_id, provider: 'GETYOURGUIDE', isActive: true },
      select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
    })
  }

  if (!link) {
    console.warn(`GYG booking ${booking_id} for unknown tour_id ${tour_id} / partner_ref ${partner_ref}`)
    return NextResponse.json({ ok: true, matched: false })
  }

  const grossCents = Math.round(gross_amount * 100)
  const commissionCents = Math.round(commission_amount * 100)
  const platformFee = 0
  const creatorEarnings = commissionCents - platformFee
  const attribution = resolveAttributedTripKitId({
    explicitTripKitId: parsedPartnerRef.tripKitId,
    linkedTripKitIds: link.tripKits.map((tripKit) => tripKit.id),
  })

  await prisma.$transaction([
    prisma.commission.create({
      data: {
        creatorId: link.creatorId,
        affiliateLinkId: link.id,
        provider: 'GETYOURGUIDE',
        externalConversionId: booking_id,
        grossAmount: grossCents,
        commissionAmount: commissionCents,
        platformFee,
        creatorEarnings,
        currency,
        attributedTripKitId: attribution.tripKitId,
        attributionMethod: attribution.attributionMethod,
        status: 'CONFIRMED',
        convertedAt: booked_at ? new Date(booked_at) : new Date(),
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
