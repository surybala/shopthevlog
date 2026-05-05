// POST /api/insights/briefs
// Creates a ContentBrief with status FILMING from an IdeaAugmentation result.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { recordApiObservation } from '@/lib/observability'

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) =>
    recordApiObservation('/api/insights/briefs', status, Date.now() - startedAt, detail)

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

  const { title, hookIdeas, contentOutline, reasoning, estimatedScore } =
    body as Record<string, unknown>

  if (typeof title !== 'string' || !title.trim()) {
    record(400, 'missing_title')
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // Requires at least one insight to attach the brief to
  const latestInsight = await prisma.channelInsight.findFirst({
    where: { creatorId: creator.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!latestInsight) {
    record(422, 'no_insight')
    return NextResponse.json(
      { error: 'Run a channel analysis first before saving a brief.' },
      { status: 422 },
    )
  }

  const brief = await prisma.contentBrief.create({
    data: {
      creatorId: creator.id,
      insightId: latestInsight.id,
      title: title.trim(),
      hookIdeas: Array.isArray(hookIdeas) ? hookIdeas : [],
      contentOutline: Array.isArray(contentOutline) ? contentOutline : [],
      reasoning: typeof reasoning === 'string' ? reasoning : null,
      estimatedScore: typeof estimatedScore === 'number' ? estimatedScore : 50,
      briefStatus: 'FILMING',
    },
  })

  record(201, 'created')
  return NextResponse.json({ brief }, { status: 201 })
}
