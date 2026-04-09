import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma/client'
import { resolveAttributedTripKitId } from '@/lib/affiliateTracking'

// Stay22 sends conversions when a hotel booking completes.
// Payload shape (from Stay22 docs):
//   { conversion_id, link_id, gross_amount_usd, commission_usd, currency, converted_at }
// link_id maps to AffiliateLink.providerProductId

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STAY22_WEBHOOK_SECRET
  if (!secret) {
    console.error('STAY22_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-stay22-signature') ?? ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: {
    conversion_id: string
    link_id: string
    gross_amount_usd: number
    commission_usd: number
    currency?: string
    converted_at?: string
  }

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { conversion_id, link_id, gross_amount_usd, commission_usd, currency = 'USD', converted_at } = payload

  if (!conversion_id || !link_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Idempotency — ignore duplicate conversions
  const existing = await prisma.commission.findUnique({ where: { externalConversionId: conversion_id } })
  if (existing) return NextResponse.json({ ok: true, duplicate: true })

  // Find the affiliate link by provider product ID (Stay22 link_id)
  const link = await prisma.affiliateLink.findFirst({
    where: { providerProductId: link_id, provider: 'STAY22', isActive: true },
    select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
  })

  if (!link) {
    // Log but acknowledge — Stay22 expects 200 or they retry
    console.warn(`Stay22 conversion ${conversion_id} for unknown link_id ${link_id}`)
    return NextResponse.json({ ok: true, matched: false })
  }

  const grossCents = Math.round(gross_amount_usd * 100)
  const commissionCents = Math.round(commission_usd * 100)
  // No platform fee for affiliate pass-through commissions
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
        provider: 'STAY22',
        externalConversionId: conversion_id,
        grossAmount: grossCents,
        commissionAmount: commissionCents,
        platformFee,
        creatorEarnings,
        currency,
        attributedTripKitId: attribution.tripKitId,
        attributionMethod: attribution.attributionMethod,
        status: 'CONFIRMED',
        convertedAt: converted_at ? new Date(converted_at) : new Date(),
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
