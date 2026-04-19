import { createAffiliateWebhookHandler } from '@/lib/affiliateWebhook'
import { parseAffiliatePartnerRef } from '@/lib/affiliateTracking'

// GetYourGuide sends a booking confirmation webhook when a tour is booked.
// Payload: { booking_id, partner_ref?, tour_id, gross_amount, commission_amount, currency?, booked_at? }
// partner_ref is the value we pass as `partner_reference` when constructing the GYG link.
export const POST = createAffiliateWebhookHandler({
  provider: 'GETYOURGUIDE',
  secretEnvVar: 'GYG_WEBHOOK_SECRET',
  signatureHeader: 'x-gyg-signature',
  parsePayload(raw) {
    const p = raw as Record<string, unknown>
    if (!p.booking_id || !p.tour_id) throw new Error('Missing required fields')
    const { shortCode } = parseAffiliatePartnerRef(p.partner_ref ? String(p.partner_ref) : null)
    return {
      externalConversionId: String(p.booking_id),
      providerProductId: String(p.tour_id),
      shortCode,
      grossAmount: Number(p.gross_amount),
      commissionAmount: Number(p.commission_amount),
      currency: p.currency ? String(p.currency) : 'USD',
      convertedAt: p.booked_at ? String(p.booked_at) : undefined,
    }
  },
})
