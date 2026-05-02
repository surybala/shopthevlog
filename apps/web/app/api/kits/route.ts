import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import {
  requireString,
  optionalString,
  optionalInt,
  requireEnum,
  validationErrorResponse,
} from '@/lib/validate'

const ACCESS_TIERS = ['FREE', 'FOLLOWER', 'PREMIUM'] as const

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  if (rateLimit(user.id, 'kits:create', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  if (creator.plan === 'FREE') {
    const count = await prisma.tripKit.count({ where: { creatorId: creator.id } })
    if (count >= 3) {
      return NextResponse.json(
        { error: 'FREE plan allows up to 3 Trip Kits. Upgrade to PRO for unlimited.' },
        { status: 403 }
      )
    }
  }

  let title: string,
      slug: string,
      description: string | null,
      primaryCity: string | null,
      countries: string[],
      cities: string[],
      durationDays: number | null,
      estimatedBudgetLow: number | null,
      estimatedBudgetHigh: number | null,
      accessTier: typeof ACCESS_TIERS[number]

  try {
    const body = await req.json()
    title             = requireString(body.title, 'title', { max: 200 })
    slug              = requireString(body.slug, 'slug', { max: 200 })
    description       = optionalString(body.description, 'description', { max: 1000 })
    primaryCity       = optionalString(body.primaryCity, 'primaryCity', { max: 100 })
    durationDays      = optionalInt(body.durationDays, 'durationDays', { min: 1, max: 365 })
    estimatedBudgetLow  = optionalInt(body.estimatedBudgetLow, 'estimatedBudgetLow', { min: 0, max: 1_000_000 })
    estimatedBudgetHigh = optionalInt(body.estimatedBudgetHigh, 'estimatedBudgetHigh', { min: 0, max: 1_000_000 })
    accessTier        = requireEnum(body.accessTier ?? 'FREE', 'accessTier', ACCESS_TIERS)

    // Validate budget ordering
    if (
      estimatedBudgetLow !== null &&
      estimatedBudgetHigh !== null &&
      estimatedBudgetLow > estimatedBudgetHigh
    ) {
      return NextResponse.json(
        { error: 'estimatedBudgetLow must be less than or equal to estimatedBudgetHigh' },
        { status: 422 }
      )
    }

    // Arrays — sanitise each element
    countries = Array.isArray(body.countries)
      ? body.countries.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 20)
      : []
    cities = Array.isArray(body.cities)
      ? body.cities.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 50)
      : []

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { error: 'slug may only contain lowercase letters, numbers, and hyphens' },
        { status: 422 }
      )
    }
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const existing = await prisma.tripKit.findUnique({
    where: { creatorId_slug: { creatorId: creator.id, slug } },
  })
  if (existing) return NextResponse.json({ error: 'A kit with this slug already exists' }, { status: 409 })

  const kit = await prisma.tripKit.create({
    data: {
      creatorId: creator.id,
      title,
      slug,
      description,
      primaryCity,
      countries,
      cities,
      durationDays,
      estimatedBudgetLow,
      estimatedBudgetHigh,
      accessTier,
      isPublished: false,
      isFeatured: false,
    },
  })

  return NextResponse.json(kit, { status: 201 })
}
