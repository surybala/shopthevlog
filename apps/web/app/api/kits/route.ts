import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  // Plan limits
  if (creator.plan === 'FREE') {
    const count = await prisma.tripKit.count({ where: { creatorId: creator.id } })
    if (count >= 3) return NextResponse.json({ error: 'FREE plan allows up to 3 Trip Kits. Upgrade to PRO for unlimited.' }, { status: 403 })
  }

  const body = await req.json()
  const { title, slug, description, primaryCity, countries, cities, durationDays, estimatedBudgetLow, estimatedBudgetHigh, accessTier, isPublished, isFeatured } = body

  if (!title || !slug) return NextResponse.json({ error: 'title and slug are required' }, { status: 422 })

  // Ensure slug is unique for this creator
  const existing = await prisma.tripKit.findUnique({ where: { creatorId_slug: { creatorId: creator.id, slug } } })
  if (existing) return NextResponse.json({ error: 'A kit with this slug already exists' }, { status: 409 })

  const kit = await prisma.tripKit.create({
    data: {
      creatorId: creator.id,
      title,
      slug,
      description: description ?? null,
      primaryCity: primaryCity ?? null,
      countries: countries ?? [],
      cities: cities ?? [],
      durationDays: durationDays ?? null,
      estimatedBudgetLow: estimatedBudgetLow ?? null,
      estimatedBudgetHigh: estimatedBudgetHigh ?? null,
      accessTier: accessTier ?? 'FREE',
      isPublished: isPublished ?? false,
      isFeatured: isFeatured ?? false,
    },
  })

  return NextResponse.json(kit, { status: 201 })
}
