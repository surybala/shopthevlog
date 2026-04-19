import { NextRequest, NextResponse } from 'next/server'
import { createAffiliateWebhookHandler } from '@/lib/affiliateWebhook'

// Viator sends booking confirmation webhooks via the Partner API.
// Payload: { bookingRef, mcid?, productCode, grossAmount, commissionAmount, currency?, bookedAt? }
const handler = createAffiliateWebhookHandler({
  provider: 'VIATOR',
  secretEnvVar: 'VIATOR_WEBHOOK_SECRET',
  signatureHeader: 'x-viator-signature',
  parsePayload(raw) {
    const p = raw as Record<string, unknown>
    if (!p.bookingRef || !p.productCode) throw new Error('Missing required fields')
    return {
      externalConversionId: String(p.bookingRef),
      providerProductId: String(p.productCode),
      grossAmount: Number(p.grossAmount),
      commissionAmount: Number(p.commissionAmount),
      currency: p.currency ? String(p.currency) : 'USD',
      convertedAt: p.bookedAt ? String(p.bookedAt) : undefined,
    }
  },
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Confirm this is our MCID before handing off, to guard against misconfigured webhooks
  const rawBody = await req.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(rawBody) } catch { /* handled by factory */ }

  const ourMcid = process.env.VIATOR_MCID
  const incomingMcid = parsed.mcid ? String(parsed.mcid) : null
  if (ourMcid && incomingMcid && incomingMcid !== ourMcid) {
    return NextResponse.json({ error: 'MCID mismatch' }, { status: 400 })
  }

  // Re-create the request with the already-consumed body so the factory can read it
  const cloned = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  })
  return handler(new NextRequest(cloned))
}
