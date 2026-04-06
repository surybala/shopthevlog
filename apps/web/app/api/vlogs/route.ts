import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const vlogs = await prisma.vlog.findMany({
    where: { creatorId: creator.id },
    orderBy: { publishedAt: 'desc' },
    include: {
      tripKits: {
        include: {
          tripKit: {
            select: { id: true, title: true, slug: true, isPublished: true },
          },
        },
      },
    },
  })

  return NextResponse.json({ vlogs })
}
