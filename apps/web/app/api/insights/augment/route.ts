// POST /api/insights/augment
// Proxies the creator's rough idea to the FastAPI backend for AI augmentation.
// Returns personalized recommendations grounded in their channel insights.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'
import { validateIdeaLength, resolveIdeaQuota, utcDayStart } from '@/lib/ideaWorkshop'

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
  if (typeof idea !== 'string') {
    record(400, 'idea_missing')
    return NextResponse.json({ error: 'idea is required' }, { status: 400 })
  }

  // Character bounds keep the workshop a focused brainstorming tool (and cap
  // per-request token spend) rather than a general-purpose LLM prompt box.
  const lengthCheck = validateIdeaLength(idea)
  if (!lengthCheck.ok) {
    record(400, 'idea_length_invalid')
    return NextResponse.json({ error: lengthCheck.error }, { status: 400 })
  }

  // Per-tier daily request quota bounds total token usage by plan.
  const usedToday = await prisma.ideaAugmentation.count({
    where: { creatorId: creator.id, createdAt: { gte: utcDayStart() } },
  })
  const quota = resolveIdeaQuota(creator.plan, usedToday)
  if (quota.exceeded) {
    record(429, 'idea_quota_exceeded')
    return NextResponse.json(
      {
        error: `You've used all ${quota.limit} Idea Workshop runs for today on the ${creator.plan} plan. Resets at ${quota.resetAt.toISOString()}.`,
        quota: { limit: quota.limit, used: quota.used, remaining: 0, resetAt: quota.resetAt.toISOString() },
      },
      { status: 429 },
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
  // This run consumes one quota slot (the backend persists the row), so report
  // the remaining balance to the UI.
  return NextResponse.json({
    ...data,
    quota: {
      limit: quota.limit,
      used: quota.used + 1,
      remaining: Math.max(quota.remaining - 1, 0),
      resetAt: quota.resetAt.toISOString(),
    },
  })
}
