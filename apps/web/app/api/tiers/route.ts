import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'
import {
  requireString,
  optionalString,
  optionalInt,
  requireEnum,
  ValidationError,
  validationErrorResponse,
} from '@/lib/validate'
import { rateLimit } from '@/lib/rateLimit'

const KIT_ACCESS_VALUES = ['FREE', 'FOLLOWER', 'PREMIUM'] as const

// GET /api/tiers?creatorId=xxx  — public, returns active tiers
export async function GET(req: NextRequest) {
  const creatorId = req.nextUrl.searchParams.get('creatorId')
  if (!creatorId?.trim()) {
    return NextResponse.json({ error: 'creatorId is required' }, { status: 422 })
  }

  const tiers = await prisma.subscriptionTier.findMany({
    where: { creatorId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      monthlyPrice: true,
      yearlyPrice: true,
      currency: true,
      perks: true,
      kitAccess: true,
      earlyAccess: true,
      sortOrder: true,
    },
  })

  return NextResponse.json({ tiers })
}

// POST /api/tiers  — creator only, creates a tier + Stripe Product + Price
// Body: { name, monthlyPrice, description?, yearlyPrice?, perks?, kitAccess? }
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (rateLimit(user.id, 'tiers:create', { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true, displayName: true, defaultCurrency: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  let name: string
  let monthlyPrice: number
  let description: string | null
  let yearlyPrice: number | null
  let perks: string[]
  let kitAccess: 'FREE' | 'FOLLOWER' | 'PREMIUM'

  try {
    const body = await req.json()

    name = requireString(body.name, 'name', { max: 80 })
    description = optionalString(body.description, 'description', { max: 500 })

    const rawMonthly = optionalInt(body.monthlyPrice, 'monthlyPrice', { min: 100, max: 100_000 })
    if (rawMonthly === null) throw new ValidationError('monthlyPrice', 'monthlyPrice is required')
    monthlyPrice = rawMonthly

    yearlyPrice = optionalInt(body.yearlyPrice, 'yearlyPrice', { min: 100, max: 1_000_000 })

    perks = Array.isArray(body.perks)
      ? body.perks
          .map((p: unknown) => String(p).trim())
          .filter(Boolean)
          .slice(0, 10)
      : []

    kitAccess = requireEnum(body.kitAccess ?? 'FREE', 'kitAccess', KIT_ACCESS_VALUES)
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const currency = creator.defaultCurrency.toLowerCase()

  // Create a Stripe Product representing this tier
  const product = await stripe.products.create({
    name: `${creator.displayName} — ${name}`,
    metadata: { creator_id: creator.id, tier_name: name },
  })

  // Monthly price
  const monthlyStripePrice = await stripe.prices.create({
    product: product.id,
    unit_amount: monthlyPrice,
    currency,
    recurring: { interval: 'month' },
    metadata: { creator_id: creator.id, billing_period: 'monthly' },
  })

  // Yearly price (optional)
  let yearlyStripePriceId: string | undefined
  if (yearlyPrice) {
    const yearlyStripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: yearlyPrice,
      currency,
      recurring: { interval: 'year' },
      metadata: { creator_id: creator.id, billing_period: 'yearly' },
    })
    yearlyStripePriceId = yearlyStripePrice.id
  }

  // Determine sort order (append to end)
  const last = await prisma.subscriptionTier.findFirst({
    where: { creatorId: creator.id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const sortOrder = (last?.sortOrder ?? -1) + 1

  const tier = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator.id,
      name,
      description,
      monthlyPrice,
      yearlyPrice,
      currency,
      perks,
      kitAccess,
      stripePriceId: monthlyStripePrice.id,
      stripePriceIdYearly: yearlyStripePriceId,
      sortOrder,
    },
  })

  return NextResponse.json({ tier }, { status: 201 })
}
