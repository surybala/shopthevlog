import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/admin'
import prisma from '@/lib/prisma/client'

/** GET /api/admin/waitlist — list all waitlist requests (admin only) */
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminUser(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status') ?? 'PENDING'
  const requests = await prisma.waitlistRequest.findMany({
    where: status === 'ALL' ? {} : { status: status as any },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(requests)
}
