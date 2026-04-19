import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
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
            select: {
              id: true,
              title: true,
              isPublished: true,
              sourceVlogs: {
                select: { vlogId: true },
              },
            },
          },
        },
      },
    },
  })
  if (!vlog) return NextResponse.json({ error: 'Vlog not found' }, { status: 404 })

  const publishedTripKit = vlog.tripKits.find((item) => item.tripKit.isPublished)
  if (publishedTripKit) {
    return NextResponse.json(
      {
        error: `This video is attached to the published Trip Kit "${publishedTripKit.tripKit.title}". Unpublish that Trip Kit, or delete it from Trip Kits, before deleting this video.`,
      },
      { status: 409 },
    )
  }

  const sharedDraftTripKit = vlog.tripKits.find(
    (item) => !item.tripKit.isPublished && item.tripKit.sourceVlogs.length > 1,
  )
  if (sharedDraftTripKit) {
    return NextResponse.json(
      {
        error: `This video is part of the draft Trip Kit "${sharedDraftTripKit.tripKit.title}", which is still connected to other videos. Remove this video from that Trip Kit or delete the draft first.`,
      },
      { status: 409 },
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      const draftTripKitIds = vlog.tripKits.map((item) => item.tripKit.id)
      await tx.tripKitsOnVlogs.deleteMany({ where: { vlogId: vlog.id } })
      if (draftTripKitIds.length > 0) {
        await tx.tripKit.deleteMany({ where: { id: { in: draftTripKitIds } } })
      }
      await tx.vlog.delete({ where: { id: vlog.id } })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json(
        {
          error:
            'This video still has Trip Kit content or related records attached. Remove the linked Trip Kit first, then try deleting the video again.',
        },
        { status: 409 },
      )
    }
    throw error
  }

  return NextResponse.json({ ok: true })
}
