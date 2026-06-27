// POST /api/insights/briefs/[id]/feedback
// Records creator feedback on a content brief (APPROVED | EDITED | REJECTED),
// mirroring the opportunity feedback loop. Powers the growth-side learning signal.
// Only the owning creator can leave feedback on their own briefs.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { recordApiObservation } from '@/lib/observability'

const VALID_ACTIONS = ['APPROVED', 'EDITED', 'REJECTED'] as const
type FeedbackActionValue = (typeof VALID_ACTIONS)[number]

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) =>
    recordApiObservation('/api/insights/briefs/[id]/feedback', status, Date.now() - startedAt, detail)

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

  const { action, reason } = body as Record<string, unknown>

  if (!VALID_ACTIONS.includes(action as FeedbackActionValue)) {
    record(400, 'invalid_action')
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const brief = await prisma.contentBrief.findUnique({ where: { id: params.id } })
  if (!brief || brief.creatorId !== creator.id) {
    record(404, 'brief_not_found')
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  }

  const feedback = await prisma.briefFeedback.create({
    data: {
      creatorId: creator.id,
      briefId: params.id,
      action: action as FeedbackActionValue,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
    },
  })

  record(200, 'recorded')
  return NextResponse.json({ feedback })
}
