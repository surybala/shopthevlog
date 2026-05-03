// POST /api/insights/augment
// Proxies the creator's rough idea to the FastAPI backend for AI augmentation.
// Returns personalized recommendations grounded in their channel insights.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) =>
    recordApiObservation('/api/insights/augment', status, Date.now() - startedAt, detail)

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (rateLimit(user.id, 'insights:augment', { limit: 10, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
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

  const idea = (body as Record<string, unknown>)?.idea
  if (typeof idea !== 'string' || idea.trim().length < 10) {
    record(400, 'idea_too_short')
    return NextResponse.json(
      { error: 'idea must be at least 10 characters' },
      { status: 400 },
    )
  }

  const aiUrl = process.env.AI_PIPELINE_URL
  if (!aiUrl) {
    record(503, 'ai_pipeline_not_configured')
    return NextResponse.json(
      { error: 'AI pipeline not configured — set AI_PIPELINE_URL' },
      { status: 503 },
    )
  }

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    record(401, 'missing_session')
    return NextResponse.json({ error: 'No active session' }, { status: 401 })
  }

  const res = await fetch(`${aiUrl}/api/v1/insights/augment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ idea: idea.trim() }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    record(res.status, 'augment_failed')
    return NextResponse.json(
      { error: (errBody as Record<string, unknown>).detail ?? 'Could not augment idea right now.' },
      { status: res.status },
    )
  }

  const data = await res.json()
  record(200, 'augmented')
  return NextResponse.json(data)
}
