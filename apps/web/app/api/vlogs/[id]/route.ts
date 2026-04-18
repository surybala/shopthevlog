import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const vlog = await prisma.vlog.findFirst({
    where: { id: params.id, creatorId: creator.id },
    include: {
      tripKits: {
        include: {
          tripKit: {
            select: { id: true, title: true, isPublished: true },
          },
        },
      },
    },
  })
  if (!vlog) return NextResponse.json({ error: 'Vlog not found' }, { status: 404 })

  const publishedTripKit = vlog.tripKits.find((item) => item.tripKit.isPublished)
  if (publishedTripKit) {
    return NextResponse.json(
      { error: 'This video powers a published Trip Kit. Unpublish or delete the kit first.' },
      { status: 409 },
    )
  }

  await prisma.$transaction(async (tx) => {
    const draftTripKitIds = vlog.tripKits.map((item) => item.tripKit.id)
    if (draftTripKitIds.length > 0) {
      await tx.tripKit.deleteMany({ where: { id: { in: draftTripKitIds } } })
    }
    await tx.tripKitsOnVlogs.deleteMany({ where: { vlogId: vlog.id } })
    await tx.vlog.delete({ where: { id: vlog.id } })
  })

  return NextResponse.json({ ok: true })
}
