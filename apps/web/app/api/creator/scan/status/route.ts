import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import { getCreatorProcessingQuotaSnapshot } from '@/lib/creatorProcessingQuota'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: {
      plan: true,
      catalogScanStatus: true,
      lastCatalogScan: true,
      processingCreditsUsed: true,
      processingCreditsResetAt: true,
      _count: { select: { vlogs: true } },
    },
  })
  if (!creator) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { maxImportedVlogs } = getCreatorPlanConfig(creator.plan)
  const processingQuota = getCreatorProcessingQuotaSnapshot({
    plan: creator.plan,
    used: creator.processingCreditsUsed,
    resetAt: creator.processingCreditsResetAt,
  })

  return NextResponse.json({
    plan: creator.plan,
    status: creator.catalogScanStatus,
    lastCatalogScan: creator.lastCatalogScan,
    vlogCount: creator._count.vlogs,
    vlogLimit: maxImportedVlogs,
    remainingVlogSlots: Math.max(maxImportedVlogs - creator._count.vlogs, 0),
    limitReached: creator._count.vlogs >= maxImportedVlogs,
    processingCreditsUsed: processingQuota.used,
    processingCreditsLimit: processingQuota.limit,
    remainingProcessingCredits: processingQuota.remaining,
    processingCreditsResetAt: processingQuota.resetAt,
  })
}
