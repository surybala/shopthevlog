import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'
import { getOrCreateSubscriber } from '@/lib/subscriber'
import { recordApiObservation } from '@/lib/observability'

// GET /api/checkout/subscribe?tierId=xxx&billing=monthly|yearly
//
// Creates a Stripe Checkout session for the requested tier and redirects
// the browser there.  After payment Stripe redirects to /checkout/success.
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/checkout/subscribe', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
    record(307, 'login_redirect')
    return NextResponse.redirect(loginUrl)
  }

  const tierId = req.nextUrl.searchParams.get('tierId')
  const billing = req.nextUrl.searchParams.get('billing') === 'yearly' ? 'yearly' : 'monthly'

  if (!tierId?.trim()) {
    record(422, 'tier_id_required')
    return NextResponse.json({ error: 'tierId is required' }, { status: 422 })
  }

  // Load the tier
  const tier = await prisma.subscriptionTier.findUnique({
    where: { id: tierId, isActive: true },
    include: { creator: { select: { id: true, handle: true, displayName: true } } },
  })
  if (!tier) {
    record(404, 'tier_missing')
    return NextResponse.json({ error: 'Tier not found or inactive' }, { status: 404 })
  }

  const stripePriceId =
    billing === 'yearly' && tier.stripePriceIdYearly
      ? tier.stripePriceIdYearly
      : tier.stripePriceId

  if (!stripePriceId) {
    record(422, 'stripe_price_missing')
    return NextResponse.json(
      { error: 'This tier is not yet configured for payments. Contact the creator.' },
      { status: 422 }
    )
  }

  // Prevent creators from subscribing to their own tiers
  const isOwnCreator = await prisma.creator.findUnique({
    where: { userId: user.id, id: tier.creatorId },
    select: { id: true },
  })
  if (isOwnCreator) {
    record(422, 'own_creator_blocked')
    return NextResponse.json({ error: 'Creators cannot subscribe to their own tiers' }, { status: 422 })
  }

  // Get or create the Subscriber record
  const subscriber = await getOrCreateSubscriber(user)

  // Load subscriber's stripeCustomerId if already set
  const subscriberRecord = await prisma.subscriber.findUnique({
    where: { id: subscriber.id },
    select: { stripeCustomerId: true },
  })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
    mode: 'subscription',
    line_items: [{ price: stripePriceId, quantity: 1 }],
    // Embed subscriber + creator IDs so the webhook can link everything up
    subscription_data: {
      metadata: {
        subscriber_id: subscriber.id,
        creator_id: tier.creatorId,
        tier_id: tier.id,
        billing_period: billing,
      },
    },
    success_url: `${baseUrl}/checkout/success?creator=${tier.creator.handle}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/@${tier.creator.handle}/subscribe`,
    // Allow promotion codes for discount campaigns
    allow_promotion_codes: true,
  }

  if (subscriberRecord?.stripeCustomerId) {
    // Reuse existing Stripe customer to preserve payment history
    sessionParams.customer = subscriberRecord.stripeCustomerId
  } else {
    // Pass email so Stripe pre-fills the checkout form
    sessionParams.customer_email = user.email
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  if (!session.url) {
    record(500, 'checkout_session_missing_url')
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }

  record(307, 'stripe_redirect')
  return NextResponse.redirect(session.url)
}
