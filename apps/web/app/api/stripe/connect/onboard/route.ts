import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'

function getBaseUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      handle: true,
      displayName: true,
      stripeAccountId: true,
      defaultCurrency: true,
      payoutsEnabled: true,
    },
  })

  if (!creator) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  let stripeAccountId = creator.stripeAccountId

  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: (process.env.STRIPE_CONNECT_COUNTRY ?? 'US').toUpperCase(),
      email: user.email ?? undefined,
      business_type: 'individual',
      default_currency: (creator.defaultCurrency ?? 'USD').toLowerCase(),
      metadata: {
        creator_id: creator.id,
        creator_handle: creator.handle,
      },
      business_profile: {
        name: creator.displayName,
        product_description: 'Travel creator subscriptions and affiliate earnings from TripKits creator portals',
      },
    })

    stripeAccountId = account.id

    await prisma.creator.update({
      where: { id: creator.id },
      data: { stripeAccountId },
    })
  }

  const baseUrl = getBaseUrl(req)
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    type: 'account_onboarding',
    refresh_url: `${baseUrl}/api/stripe/connect/onboard`,
    return_url: `${baseUrl}/dashboard/payouts?stripe=connected`,
  })

  return NextResponse.redirect(accountLink.url)
}
