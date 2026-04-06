import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  if (!creator.youtubeChannelId) {
    return NextResponse.json({ error: 'Connect a YouTube channel first' }, { status: 400 })
  }

  await prisma.creator.update({
    where: { id: creator.id },
    data: { catalogScanStatus: 'QUEUED' },
  })

  // Notify AI pipeline (fire-and-forget; pipeline URL from env)
  const aiUrl = process.env.AI_PIPELINE_URL
  if (aiUrl) {
    fetch(`${aiUrl}/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creator.id }),
    }).catch(() => {})
  }

  return NextResponse.json({ status: 'QUEUED' })
}
