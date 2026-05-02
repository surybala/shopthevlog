import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import prisma from '@/lib/prisma/client'

type WaitlistStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
const WAITLIST_STATUSES: WaitlistStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

/** GET /api/admin/waitlist — list all waitlist requests (admin only) */
export async function GET(req: NextRequest) {
  const result = await requireAdmin()
  if (result instanceof NextResponse) return result

  const rawStatus = req.nextUrl.searchParams.get('status') ?? 'PENDING'
  const showAll = rawStatus === 'ALL'
  if (!showAll && !(WAITLIST_STATUSES as string[]).includes(rawStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ALL, ${WAITLIST_STATUSES.join(', ')}` },
      { status: 422 },
    )
  }

  const requests = await prisma.waitlistRequest.findMany({
    where: showAll ? {} : { status: rawStatus as WaitlistStatus },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(requests)
}
