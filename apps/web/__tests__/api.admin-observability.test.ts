import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mockGetUser = vi.fn()
const mockRequireAdmin = vi.fn()
const mockCreatorCount = vi.fn()
const mockSubscriberCount = vi.fn()
const mockTripKitCount = vi.fn()
const mockSubscriptionCount = vi.fn()
const mockVlogCount = vi.fn()
const mockCreatorGroupBy = vi.fn()
const mockVlogGroupBy = vi.fn()
const mockGetApiObservabilitySnapshot = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      count: (...args: unknown[]) => mockCreatorCount(...args),
      groupBy: (...args: unknown[]) => mockCreatorGroupBy(...args),
    },
    subscriber: {
      count: (...args: unknown[]) => mockSubscriberCount(...args),
    },
    tripKit: {
      count: (...args: unknown[]) => mockTripKitCount(...args),
    },
    subscription: {
      count: (...args: unknown[]) => mockSubscriptionCount(...args),
    },
    vlog: {
      count: (...args: unknown[]) => mockVlogCount(...args),
      groupBy: (...args: unknown[]) => mockVlogGroupBy(...args),
    },
  },
}))

vi.mock('@/lib/observability', () => ({
  getApiObservabilitySnapshot: (...args: unknown[]) => mockGetApiObservabilitySnapshot(...args),
}))

vi.mock('@/lib/admin', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}))

import { GET } from '../app/api/admin/observability/route'

describe('admin observability route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-user' } } })
    mockRequireAdmin.mockResolvedValue({ id: 'admin-user' })
    mockCreatorCount
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
    mockSubscriberCount.mockResolvedValue(9)
    mockTripKitCount.mockResolvedValue(6)
    mockSubscriptionCount.mockResolvedValue(3)
    mockVlogCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(28)
    mockCreatorGroupBy.mockResolvedValue([
      { catalogScanStatus: 'COMPLETE', _count: { _all: 3 } },
      { catalogScanStatus: 'FAILED', _count: { _all: 1 } },
    ])
    mockVlogGroupBy.mockResolvedValue([
      { processingStatus: 'REVIEW_PENDING', _count: { _all: 28 } },
      { processingStatus: 'FAILED', _count: { _all: 3 } },
    ])
    mockGetApiObservabilitySnapshot.mockReturnValue({
      routes: [{ route: '/api/test', total: 5, errors: 1, errorRate: 0.2, p95DurationMs: 150 }],
      alerts: [{ severity: 'warning', source: '/api/test', message: 'API error rate is 20.0% over the last 15 minutes.' }],
      recentEvents: [],
      windowMs: 900000,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns aggregated observability summary and alerts', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.summary).toEqual({
      creators: 4,
      subscribers: 9,
      publishedTripKits: 6,
      activeSubscriptions: 3,
      failedScans: 1,
      failedVlogs: 3,
      reviewPendingVlogs: 28,
    })
    expect(body.scanStatusCounts).toEqual({
      COMPLETE: 3,
      FAILED: 1,
    })
    expect(body.processingStatusCounts).toEqual({
      REVIEW_PENDING: 28,
      FAILED: 3,
    })
    expect(body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '/api/test' }),
        expect.objectContaining({ source: 'creator.scan' }),
        expect.objectContaining({ source: 'pipeline.vlogs' }),
        expect.objectContaining({ source: 'pipeline.review_queue' }),
      ]),
    )
  })
})
