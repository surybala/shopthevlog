import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { stripe } from '@/lib/stripe'
import {
  optionalString,
  requireEnum,
  ValidationError,
  validationErrorResponse,
} from '@/lib/validate'

const KIT_ACCESS_VALUES = ['FREE', 'FOLLOWER', 'PREMIUM'] as const

// PATCH /api/tiers/[id]  — update name, description, perks, kitAccess
// Price cannot be changed (create a new tier instead)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const tier = await prisma.subscriptionTier.findUnique({
    where: { id: params.id },
    select: { id: true, creatorId: true, stripePriceId: true },
  })
  if (!tier || tier.creatorId !== creator.id) {
    return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
  }

  let name: string | null
  let description: string | null
  let perks: string[] | undefined
  let kitAccess: 'FREE' | 'FOLLOWER' | 'PREMIUM' | undefined

  try {
    const body = await req.json()

    name = optionalString(body.name, 'name', { max: 80 })
    description = optionalString(body.description, 'description', { max: 500 })

    if (body.perks !== undefined) {
      if (!Array.isArray(body.perks)) throw new ValidationError('perks', 'perks must be an array')
      perks = body.perks
        .map((p: unknown) => String(p).trim())
        .filter(Boolean)
        .slice(0, 10)
    }

    if (body.kitAccess !== undefined) {
      kitAccess = requireEnum(body.kitAccess, 'kitAccess', KIT_ACCESS_VALUES)
    }
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const updated = await prisma.subscriptionTier.update({
    where: { id: params.id },
    data: {
      ...(name !== null && name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(perks !== undefined ? { perks } : {}),
      ...(kitAccess !== undefined ? { kitAccess } : {}),
    },
  })

  return NextResponse.json({ tier: updated })
}

// DELETE /api/tiers/[id]  — deactivate tier (archive Stripe price, mark isActive=false)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const tier = await prisma.subscriptionTier.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      creatorId: true,
      stripePriceId: true,
      stripePriceIdYearly: true,
      _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } },
    },
  })
  if (!tier || tier.creatorId !== creator.id) {
    return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
  }

  if (tier._count.subscriptions > 0) {
    return NextResponse.json(
      { error: 'Cannot deactivate a tier with active subscribers. Cancel their subscriptions first.' },
      { status: 409 }
    )
  }

  // Archive Stripe prices so no new subscriptions can use them
  if (tier.stripePriceId) {
    await stripe.prices.update(tier.stripePriceId, { active: false }).catch(() => {})
  }
  if (tier.stripePriceIdYearly) {
    await stripe.prices.update(tier.stripePriceIdYearly, { active: false }).catch(() => {})
  }

  await prisma.subscriptionTier.update({
    where: { id: params.id },
    data: { isActive: false },
  })

  return NextResponse.json({ deactivated: true })
}
