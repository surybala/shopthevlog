import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the vlog belongs to this creator
  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const vlog = await prisma.vlog.findFirst({
    where: { id: params.id, creatorId: creator.id },
  })
  if (!vlog) return NextResponse.json({ error: 'Vlog not found' }, { status: 404 })

  if (vlog.processingStatus === 'TRANSCRIBING' || vlog.processingStatus === 'EXTRACTING') {
    return NextResponse.json({ status: vlog.processingStatus, message: 'Already processing' })
  }

  const aiUrl = process.env.AI_PIPELINE_URL
  if (!aiUrl) {
    return NextResponse.json(
      { error: 'AI pipeline not configured — set AI_PIPELINE_URL' },
      { status: 503 }
    )
  }

  // Forward request to Python backend with the user's session token
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return NextResponse.json({ error: 'No active session' }, { status: 401 })

  const res = await fetch(`${aiUrl}/api/v1/vlogs/${params.id}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: body.detail ?? 'Processing trigger failed' },
      { status: res.status }
    )
  }

  return NextResponse.json(await res.json())
}
