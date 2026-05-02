import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function verifyOwnership(userId: string, kitId: string, dayId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null
  const day = await prisma.itineraryDay.findUnique({
    where: { id: dayId },
    include: { tripKit: { select: { creatorId: true } } },
  })
  if (!day || day.tripKitId !== kitId || day.tripKit.creatorId !== creator.id) return null
  return { creator, day }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id, params.dayId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.itineraryDay.update({
    where: { id: params.dayId },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.summary !== undefined && { summary: body.summary }),
      ...(body.city !== undefined && { city: body.city }),
      ...(body.country !== undefined && { country: body.country }),
    },
    include: { activities: { orderBy: { sortOrder: 'asc' }, include: { affiliateLink: true } } },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id, params.dayId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Cascade: delete activities first, then the day
  await prisma.dayActivity.deleteMany({ where: { dayId: params.dayId } })
  await prisma.itineraryDay.delete({ where: { id: params.dayId } })

  // Re-number remaining days sequentially
  const remaining = await prisma.itineraryDay.findMany({
    where: { tripKitId: params.id },
    orderBy: { dayNumber: 'asc' },
  })
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].dayNumber !== i + 1) {
      await prisma.itineraryDay.update({
        where: { id: remaining[i].id },
        data: { dayNumber: i + 1 },
      })
    }
  }

  return NextResponse.json({ ok: true })
}
