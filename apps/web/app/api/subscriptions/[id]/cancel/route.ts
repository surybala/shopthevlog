import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'

// POST /api/subscriptions/[id]/cancel
//
// Sets cancel_at_period_end = true in Stripe so the subscriber keeps access
// until the end of the billing period.  The webhook will mark the DB record
// as CANCELED when the period actually ends.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load the subscription and verify ownership
  const subscriber = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!subscriber) return NextResponse.json({ error: 'Subscriber profile not found' }, { status: 404 })

  const subscription = await prisma.subscription.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      subscriberId: true,
      stripeSubId: true,
      status: true,
      cancelAtPeriodEnd: true,
    },
  })

  if (!subscription || subscription.subscriberId !== subscriber.id) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  if (subscription.status === 'CANCELED') {
    return NextResponse.json({ error: 'Subscription is already canceled' }, { status: 409 })
  }

  if (subscription.cancelAtPeriodEnd) {
    return NextResponse.json({ error: 'Subscription is already set to cancel at period end' }, { status: 409 })
  }

  if (!subscription.stripeSubId) {
    return NextResponse.json({ error: 'No Stripe subscription linked' }, { status: 422 })
  }

  // Tell Stripe to cancel at period end (preserves access until then)
  await stripe.subscriptions.update(subscription.stripeSubId, {
    cancel_at_period_end: true,
  })

  // Optimistically update the DB — the webhook will also fire and confirm
  const updated = await prisma.subscription.update({
    where: { id: params.id },
    data: { cancelAtPeriodEnd: true },
  })

  return NextResponse.json({ subscription: updated })
}
