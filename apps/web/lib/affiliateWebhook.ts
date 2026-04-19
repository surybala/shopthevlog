/**
 * Shared handler factory for affiliate-partner booking webhooks (Stay22, GYG, Viator, …).
 *
 * All three providers follow the same flow:
 *   1. Verify HMAC-SHA256 signature
 *   2. Parse JSON body
 *   3. Idempotency check on externalConversionId
 *   4. Look up the AffiliateLink by providerProductId (and optionally shortCode)
 *   5. Write Commission + update AffiliateLink + update TripKit in a transaction
 *
 * Callers supply only the parts that differ between providers.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { resolveAttributedTripKitId } from '@/lib/affiliateTracking'

export type AffiliateProviderName =
  | 'STAY22'
  | 'GETYOURGUIDE'
  | 'VIATOR'
  | 'BOOKING_COM'
  | 'EXPEDIA'

export interface NormalisedBooking {
  /** Unique booking/conversion ID used for idempotency */
  externalConversionId: string
  /** Provider's product/tour/hotel identifier — maps to AffiliateLink.providerProductId */
  providerProductId: string
  /** Our short-code embedded in the outbound link (optional, used by GYG partner_ref) */
  shortCode?: string | null
  /** Explicit Trip Kit from the outbound link payload, when the provider echoes it back */
  explicitTripKitId?: string | null
  /** Amount the user paid, in the native currency unit (dollars/euros, not cents) */
  grossAmount: number
  /** Commission earned, in the native currency unit */
  commissionAmount: number
  currency?: string
  /** ISO 8601 string of when the booking was made */
  convertedAt?: string
}

export interface WebhookHandlerConfig {
  provider: AffiliateProviderName
  /** Name of the env var holding the HMAC secret, e.g. 'GYG_WEBHOOK_SECRET' */
  secretEnvVar: string
  /** Name of the HTTP header carrying the HMAC hex digest, e.g. 'x-gyg-signature' */
  signatureHeader: string
  /** Parse the raw (already-verified) JSON body into a NormalisedBooking */
  parsePayload(raw: unknown): NormalisedBooking
}

// ── HMAC verification ──────────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ── Commission math ────────────────────────────────────────────────────────────

function calcCommission(grossAmount: number, commissionAmount: number) {
  const grossCents = Math.round(grossAmount * 100)
  const commissionCents = Math.round(commissionAmount * 100)
  const platformFee = 0
  const creatorEarnings = commissionCents - platformFee
  return { grossCents, commissionCents, platformFee, creatorEarnings }
}

// ── Handler factory ────────────────────────────────────────────────────────────

export function createAffiliateWebhookHandler(config: WebhookHandlerConfig) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    const secret = process.env[config.secretEnvVar]
    if (!secret) {
      console.error(`[${config.provider} webhook] ${config.secretEnvVar} not configured`)
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    const rawBody = await req.text()
    const signature = req.headers.get(config.signatureHeader) ?? ''

    if (!verifySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    let booking: NormalisedBooking
    try {
      booking = config.parsePayload(parsed)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid payload' },
        { status: 400 },
      )
    }

    // Idempotency — providers retry on non-2xx, so duplicate events are expected
    const existing = await prisma.commission.findUnique({
      where: { externalConversionId: booking.externalConversionId },
    })
    if (existing) return NextResponse.json({ ok: true, duplicate: true })

    // Resolve the affiliate link — prefer shortCode match, fall back to providerProductId
    let link = booking.shortCode
      ? await prisma.affiliateLink.findFirst({
          where: {
            shortCode: booking.shortCode,
            provider: config.provider,
            isActive: true,
          },
          select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
        })
      : null

    if (!link) {
      link = await prisma.affiliateLink.findFirst({
        where: {
          providerProductId: booking.providerProductId,
          provider: config.provider,
          isActive: true,
        },
        select: { id: true, creatorId: true, tripKits: { select: { id: true } } },
      })
    }

    if (!link) {
      console.warn(
        `[${config.provider} webhook] No link found for conversion ${booking.externalConversionId} (product: ${booking.providerProductId})`,
      )
      return NextResponse.json({ ok: true, matched: false })
    }

    const { grossCents, commissionCents, platformFee, creatorEarnings } = calcCommission(
      booking.grossAmount,
      booking.commissionAmount,
    )
    const currency = booking.currency ?? 'USD'
    const attribution = resolveAttributedTripKitId({
      explicitTripKitId: booking.explicitTripKitId,
      linkedTripKitIds: link.tripKits.map((k) => k.id),
    })

    await prisma.$transaction([
      prisma.commission.create({
        data: {
          creatorId: link.creatorId,
          affiliateLinkId: link.id,
          provider: config.provider,
          externalConversionId: booking.externalConversionId,
          grossAmount: grossCents,
          commissionAmount: commissionCents,
          platformFee,
          creatorEarnings,
          currency,
          attributedTripKitId: attribution.tripKitId,
          attributionMethod: attribution.attributionMethod,
          status: 'CONFIRMED',
          convertedAt: booking.convertedAt ? new Date(booking.convertedAt) : new Date(),
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
}
