// POST /api/insights/trigger
// Proxies to the FastAPI backend to queue a channel analysis run.
// Mirrors the vlogs/[id]/process/route.ts pattern exactly:
//   auth guard → creator lookup → rate limit → proxy with JWT → return status.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'

export async function POST(_req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/insights/trigger', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (rateLimit(user.id, 'insights:trigger', { limit: 5, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
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

  const res = await fetch(`${aiUrl}/api/v1/insights/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    record(res.status, 'trigger_failed')
    return NextResponse.json(
      { error: body.detail ?? 'Could not start analysis right now.' },
      { status: res.status },
    )
  }

  record(200, 'queued')
  return NextResponse.json(await res.json())
}
