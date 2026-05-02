import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import prisma from '@/lib/prisma/client'

/**
 * POST /api/admin/waitlist/[id]/reject
 *
 * Marks a waitlist request as REJECTED.
 * Does not send an email — keeping a low profile until we're ready to communicate rejections.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await requireAdmin()
  if (result instanceof NextResponse) return result

  const request = await prisma.waitlistRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.status === 'REJECTED') {
    return NextResponse.json({ ok: true, message: 'Already rejected' })
  }

  await prisma.waitlistRequest.update({
    where: { id: params.id },
    data: { status: 'REJECTED', rejectedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
