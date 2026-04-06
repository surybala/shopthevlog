import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function verifyOwnership(userId: string, kitId: string, dayId: string, actId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null
  const activity = await prisma.dayActivity.findUnique({
    where: { id: actId },
    include: {
      day: {
        include: { tripKit: { select: { creatorId: true } } },
      },
    },
  })
  if (
    !activity ||
    activity.dayId !== dayId ||
    activity.day.tripKitId !== kitId ||
    activity.day.tripKit.creatorId !== creator.id
  ) return null
  return { creator, activity }
}

const VALID_TYPES = new Set([
  'ACCOMMODATION', 'FOOD', 'TOUR', 'ADVENTURE',
  'CULTURAL', 'WELLNESS', 'NIGHTLIFE', 'TRANSPORT',
  'ATTRACTION', 'OTHER',
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string; actId: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id, params.dayId, params.actId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.dayActivity.update({
    where: { id: params.actId },
    data: {
      ...(body.time !== undefined && { time: body.time }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.type !== undefined && VALID_TYPES.has(body.type) && { type: body.type }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      // null explicitly detaches the link
      ...(Object.prototype.hasOwnProperty.call(body, 'affiliateLinkId') && {
        affiliateLinkId: body.affiliateLinkId,
      }),
    },
    include: { affiliateLink: true },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string; actId: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await verifyOwnership(user.id, params.id, params.dayId, params.actId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.dayActivity.delete({ where: { id: params.actId } })
  return NextResponse.json({ ok: true })
}
