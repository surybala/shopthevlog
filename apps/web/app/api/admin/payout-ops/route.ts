import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import prisma from '@/lib/prisma/client'

type BulkAction = 'confirm' | 'mark_paid' | 'reverse'

const actionConfig: Record<
  BulkAction,
  {
    allowedStatuses: Array<'PENDING' | 'CONFIRMED'>
    buildData: typeof buildUpdateData
  }
> = {
  confirm: {
    allowedStatuses: ['PENDING'],
    buildData: () => buildUpdateData('CONFIRMED'),
  },
  mark_paid: {
    allowedStatuses: ['CONFIRMED'],
    buildData: () => buildUpdateData('PAID'),
  },
  reverse: {
    allowedStatuses: ['PENDING', 'CONFIRMED'],
    buildData: () => buildUpdateData('REVERSED'),
  },
}

function buildUpdateData(status: 'CONFIRMED' | 'PAID' | 'REVERSED') {
  return {
    status,
    paidAt: status === 'PAID' ? new Date() : null,
  } as const
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin()
  if (user instanceof NextResponse) return user

  const status = req.nextUrl.searchParams.get('status')
  const commissions = await prisma.commission.findMany({
    where: status && status !== 'ALL' ? { status: status as 'PENDING' | 'CONFIRMED' | 'PAID' | 'REVERSED' } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      creator: {
        select: {
          displayName: true,
          handle: true,
        },
      },
      affiliateLink: {
        select: {
          targetName: true,
        },
      },
      attributedTripKit: {
        select: {
          title: true,
        },
      },
    },
  })

  return NextResponse.json(commissions)
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (user instanceof NextResponse) return user

  const body = await req.json().catch(() => ({}))
  const action = body.action as BulkAction | undefined
  const commissionIds = Array.isArray(body.commissionIds)
    ? body.commissionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (!action || !(action in actionConfig)) {
    return NextResponse.json({ error: 'Invalid payout ops action.' }, { status: 400 })
  }

  if (commissionIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one commission.' }, { status: 400 })
  }

  const { allowedStatuses, buildData } = actionConfig[action]
  const result = await prisma.commission.updateMany({
    where: {
      id: { in: commissionIds },
      status: { in: allowedStatuses },
    },
    data: buildData(),
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'No matching commissions could be updated.' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, updatedCount: result.count, action })
}
