import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'
import { formatVlogPipelineErrorMessage } from '@/lib/vlogProcessing'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/vlogs/[id]/process', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the vlog belongs to this creator
  if (rateLimit(user.id, 'vlogs:process', { limit: 10, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
  }

  const vlog = await prisma.vlog.findFirst({
    where: { id: params.id, creatorId: creator.id },
  })
  if (!vlog) {
    record(404, 'vlog_missing')
    return NextResponse.json({ error: 'Vlog not found' }, { status: 404 })
  }

  if (vlog.processingStatus === 'TRANSCRIBING' || vlog.processingStatus === 'EXTRACTING') {
    record(200, 'already_processing')
    return NextResponse.json({ status: vlog.processingStatus, message: 'Already processing' })
  }

  const aiUrl = process.env.AI_PIPELINE_URL
  if (!aiUrl) {
    record(503, 'ai_pipeline_not_configured')
    return NextResponse.json(
      { error: 'AI pipeline not configured — set AI_PIPELINE_URL' },
      { status: 503 }
    )
  }

  // Forward request to Python backend with the user's session token
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    record(401, 'missing_session')
    return NextResponse.json({ error: 'No active session' }, { status: 401 })
  }

  const res = await fetch(`${aiUrl}/api/v1/vlogs/${params.id}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    record(res.status, 'trigger_failed')
    return NextResponse.json(
      { error: formatVlogPipelineErrorMessage(body.detail) ?? 'Could not start processing right now.' },
      { status: res.status }
    )
  }

  record(200, 'queued')
  return NextResponse.json(await res.json())
}
