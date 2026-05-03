// PATCH /api/insights/briefs/[id]
// Updates briefStatus (IDEA | FILMING | PUBLISHED) and optionally links a publishedVlogId.
// Only the owning creator can update their own briefs.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { recordApiObservation } from '@/lib/observability'

const VALID_STATUSES = ['IDEA', 'FILMING', 'PUBLISHED'] as const
type BriefStatusValue = (typeof VALID_STATUSES)[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) =>
    recordApiObservation('/api/insights/briefs/[id]', status, Date.now() - startedAt, detail)

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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    record(400, 'invalid_json')
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { briefStatus, publishedVlogId } = body as Record<string, unknown>

  if (!VALID_STATUSES.includes(briefStatus as BriefStatusValue)) {
    record(400, 'invalid_status')
    return NextResponse.json(
      { error: `briefStatus must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const brief = await prisma.contentBrief.findUnique({ where: { id: params.id } })
  if (!brief || brief.creatorId !== creator.id) {
    record(404, 'brief_not_found')
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  }

  const updated = await prisma.contentBrief.update({
    where: { id: params.id },
    data: {
      briefStatus: briefStatus as BriefStatusValue,
      publishedVlogId: typeof publishedVlogId === 'string' ? publishedVlogId : null,
    },
  })

  record(200, 'updated')
  return NextResponse.json({ brief: updated })
}
