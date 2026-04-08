import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import prisma from '@/lib/prisma/client'

// Next.js App Router: we must read the raw body before any parsing
export const dynamic = 'force-dynamic'

// Helper: upsert the Subscription row from a Stripe Subscription object
async function syncSubscription(
  sub: Stripe.Subscription,
  overrideStatus?: 'CANCELED'
) {
  const meta = sub.metadata as {
    subscriber_id?: string
    creator_id?: string
    tier_id?: string
    billing_period?: string
  }

  const subscriberId = meta.subscriber_id
  const creatorId = meta.creator_id
  const tierId = meta.tier_id
  const billingPeriod = meta.billing_period === 'yearly' ? 'YEARLY' : 'MONTHLY'

  if (!subscriberId || !creatorId || !tierId) {
    console.warn('[stripe webhook] Subscription missing metadata — skipping', sub.id)
    return
  }

  // Map Stripe status to our enum
  const statusMap: Record<Stripe.Subscription.Status, string> = {
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
    unpaid: 'PAST_DUE',
    incomplete: 'INCOMPLETE',
    incomplete_expired: 'CANCELED',
    trialing: 'TRIALING',
    paused: 'PAST_DUE',
  }
  const status = overrideStatus ?? statusMap[sub.status] ?? 'INCOMPLETE'

  const currentPeriodStart = new Date((sub.current_period_start as number) * 1000)
  const currentPeriodEnd = new Date((sub.current_period_end as number) * 1000)
  const cancelAtPeriodEnd = sub.cancel_at_period_end
  const canceledAt = sub.canceled_at ? new Date((sub.canceled_at as number) * 1000) : null
  const trialEnd = sub.trial_end ? new Date((sub.trial_end as number) * 1000) : null

  // Store the Stripe customer ID on the Subscriber record (idempotent)
  await prisma.subscriber.update({
    where: { id: subscriberId },
    data: { stripeCustomerId: sub.customer as string },
  }).catch(() => {
    // Subscriber might not exist yet in rare race conditions; log and continue
    console.warn('[stripe webhook] Could not update stripeCustomerId for subscriber', subscriberId)
  })

  await prisma.subscription.upsert({
    where: { stripeSubId: sub.id },
    create: {
      subscriberId,
      creatorId,
      tierId,
      stripeSubId: sub.id,
      status: status as 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING' | 'INCOMPLETE',
      billingPeriod: billingPeriod as 'MONTHLY' | 'YEARLY',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      canceledAt,
      trialEnd,
    },
    update: {
      tierId,
      status: status as 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING' | 'INCOMPLETE',
      billingPeriod: billingPeriod as 'MONTHLY' | 'YEARLY',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      canceledAt,
      trialEnd,
    },
  })
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      // ── Subscription lifecycle ──────────────────────────────────────────────

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(sub)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(sub, 'CANCELED')
        break
      }

      // ── Invoice events ──────────────────────────────────────────────────────

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const stripeSubId = invoice.subscription as string | null
        if (!stripeSubId) break

        // Refresh the subscription period dates from Stripe
        const sub = await stripe.subscriptions.retrieve(stripeSubId)
        await syncSubscription(sub)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const stripeSubId = invoice.subscription as string | null
        if (!stripeSubId) break

        await prisma.subscription.updateMany({
          where: { stripeSubId },
          data: { status: 'PAST_DUE' },
        })
        break
      }

      default:
        // Acknowledge but ignore unhandled event types
        break
    }
  } catch (err) {
    console.error('[stripe webhook] Handler error for event', event.type, err)
    // Return 500 so Stripe retries
    return NextResponse.json({ error: 'Internal handler error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
