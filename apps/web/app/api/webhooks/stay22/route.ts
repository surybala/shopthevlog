import { createAffiliateWebhookHandler } from '@/lib/affiliateWebhook'

// Stay22 sends conversions when a hotel booking completes.
// Payload: { conversion_id, link_id, gross_amount_usd, commission_usd, currency?, converted_at? }
export const POST = createAffiliateWebhookHandler({
  provider: 'STAY22',
  secretEnvVar: 'STAY22_WEBHOOK_SECRET',
  signatureHeader: 'x-stay22-signature',
  parsePayload(raw) {
    const p = raw as Record<string, unknown>
    if (!p.conversion_id || !p.link_id) throw new Error('Missing required fields')
    return {
      externalConversionId: String(p.conversion_id),
      providerProductId: String(p.link_id),
      grossAmount: Number(p.gross_amount_usd),
      commissionAmount: Number(p.commission_usd),
      currency: p.currency ? String(p.currency) : 'USD',
      convertedAt: p.converted_at ? String(p.converted_at) : undefined,
    }
  },
})
