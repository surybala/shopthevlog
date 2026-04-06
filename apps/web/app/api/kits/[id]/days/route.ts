import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function verifyOwnership(userId: string, kitId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null
  const kit = await prisma.tripKit.findUnique({ where: { id: kitId } })
  if (!kit || kit.creatorId !== creator.id) return null
  return { creator, kit }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Find next day number
  const lastDay = await prisma.itineraryDay.findFirst({
    where: { tripKitId: params.id },
    orderBy: { dayNumber: 'desc' },
  })
  const nextDayNumber = (lastDay?.dayNumber ?? 0) + 1

  const body = await req.json().catch(() => ({}))
  const day = await prisma.itineraryDay.create({
    data: {
      tripKitId: params.id,
      dayNumber: nextDayNumber,
      title: body.title ?? `Day ${nextDayNumber}`,
      summary: body.summary ?? null,
      city: body.city ?? null,
      country: body.country ?? null,
      tips: [],
    },
    include: { activities: { orderBy: { sortOrder: 'asc' }, include: { affiliateLink: true } } },
  })

  return NextResponse.json(day, { status: 201 })
}
