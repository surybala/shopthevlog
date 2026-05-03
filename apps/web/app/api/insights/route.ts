// GET /api/insights
// Returns the latest ChannelInsight + ContentBriefs for the authenticated creator.
// Reads directly from Prisma — no FastAPI hop needed for GET.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { recordApiObservation } from '@/lib/observability'

export async function GET(_req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/insights', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  }

  const insight = await prisma.channelInsight.findUnique({
    where: { creatorId: creator.id },
    include: {
      briefs: {
        orderBy: { estimatedScore: 'desc' },
      },
    },
  })

  record(200)
  return NextResponse.json({ insight: insight ?? null })
}
