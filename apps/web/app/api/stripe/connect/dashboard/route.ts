import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'

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
    select: { stripeAccountId: true },
  })

  if (!creator?.stripeAccountId) {
    return NextResponse.redirect(new URL('/dashboard/payouts?stripe=missing', req.url))
  }

  const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId)
  return NextResponse.redirect(loginLink.url)
}
