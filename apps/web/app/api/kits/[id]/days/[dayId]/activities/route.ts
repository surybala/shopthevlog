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

const VALID_TYPES = new Set([
  'ACCOMMODATION', 'FOOD', 'TOUR', 'ADVENTURE',
  'CULTURAL', 'WELLNESS', 'NIGHTLIFE', 'TRANSPORT',
  'ATTRACTION', 'OTHER',
])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id, params.dayId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Next sort order
  const last = await prisma.dayActivity.findFirst({
    where: { dayId: params.dayId },
    orderBy: { sortOrder: 'desc' },
  })
  const nextSort = (last?.sortOrder ?? -1) + 1

  const body = await req.json().catch(() => ({}))
  const actType = VALID_TYPES.has(body.type) ? body.type : 'OTHER'

  const activity = await prisma.dayActivity.create({
    data: {
      dayId: params.dayId,
      sortOrder: nextSort,
      time: body.time ?? null,
      title: body.title ?? 'New Activity',
      description: body.description ?? null,
      type: actType,
    },
    include: { affiliateLink: true },
  })

  return NextResponse.json(activity, { status: 201 })
}
