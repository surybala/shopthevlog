import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import { getApiObservabilitySnapshot } from '@/lib/observability'

export async function GET() {
  const result = await requireAdmin()
  if (result instanceof NextResponse) return result

  const [
    creators,
    subscribers,
    publishedTripKits,
    activeSubscriptions,
    failedScans,
    failedVlogs,
    reviewPendingVlogs,
    scanStatusCounts,
    processingStatusCounts,
  ] = await Promise.all([
    prisma.creator.count(),
    prisma.subscriber.count(),
    prisma.tripKit.count({ where: { isPublished: true } }),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.creator.count({ where: { catalogScanStatus: 'FAILED' } }),
    prisma.vlog.count({ where: { processingStatus: 'FAILED' } }),
    prisma.vlog.count({ where: { processingStatus: 'REVIEW_PENDING' } }),
    prisma.creator.groupBy({ by: ['catalogScanStatus'], _count: { _all: true } }),
    prisma.vlog.groupBy({ by: ['processingStatus'], _count: { _all: true } }),
  ])

  const apiSnapshot = getApiObservabilitySnapshot()
  const alerts = [
    ...apiSnapshot.alerts,
    ...(failedScans > 0
      ? [{ severity: 'critical' as const, source: 'creator.scan', message: `${failedScans} creators currently have failed catalog scans.` }]
      : []),
    ...(failedVlogs > 0
      ? [{ severity: 'critical' as const, source: 'pipeline.vlogs', message: `${failedVlogs} vlogs are currently marked as FAILED.` }]
      : []),
    ...(reviewPendingVlogs > 25
      ? [{ severity: 'warning' as const, source: 'pipeline.review_queue', message: `${reviewPendingVlogs} vlogs are waiting in REVIEW_PENDING.` }]
      : []),
  ]

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary: {
      creators,
      subscribers,
      publishedTripKits,
      activeSubscriptions,
      failedScans,
      failedVlogs,
      reviewPendingVlogs,
    },
    scanStatusCounts: Object.fromEntries(scanStatusCounts.map((row) => [row.catalogScanStatus, row._count._all])),
    processingStatusCounts: Object.fromEntries(processingStatusCounts.map((row) => [row.processingStatus, row._count._all])),
    api: apiSnapshot,
    alerts,
  })
}
