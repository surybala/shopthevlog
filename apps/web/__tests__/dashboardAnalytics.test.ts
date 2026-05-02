import { describe, expect, it } from 'vitest'
import {
  buildRecentPerformanceSummary,
  buildTopEarningKitsLast7d,
  formatCurrencyFromCents,
} from '@/lib/dashboardAnalytics'

describe('dashboard analytics helpers', () => {
  it('formats cents and builds a recent performance summary', () => {
    expect(formatCurrencyFromCents(1234)).toBe('12.34')
    expect(
      buildRecentPerformanceSummary({
        clicksLast7d: 20,
        conversionsLast7d: 4,
        earningsLast7dCents: 2550,
      })
    ).toEqual({
      clicksLast7d: 20,
      conversionsLast7d: 4,
      earningsLast7dCents: 2550,
      conversionRate: 20,
      earningsLast7dDisplay: '25.50',
    })
  })

  it('maps recent clicks and link commissions into top earning kits', () => {
    const results = buildTopEarningKitsLast7d({
      kits: [
        {
          id: 'kit-1',
          title: 'Lisbon',
          slug: 'lisbon',
          viewCount: 100,
          clickCount: 20,
          conversionCount: 3,
          estimatedEarnings: 50,
        },
        {
          id: 'kit-2',
          title: 'Tokyo',
          slug: 'tokyo',
          viewCount: 90,
          clickCount: 10,
          conversionCount: 1,
          estimatedEarnings: 30,
        },
      ],
      clickGroups: [
        { tripKitId: 'kit-1', _count: { tripKitId: 6 } },
        { tripKitId: 'kit-2', _count: { tripKitId: 2 } },
      ],
      commissionGroups: [
        {
          attributedTripKitId: 'kit-1',
          _count: { attributedTripKitId: 2 },
          _sum: { creatorEarnings: 1800 },
        },
        {
          attributedTripKitId: 'kit-2',
          _count: { attributedTripKitId: 1 },
          _sum: { creatorEarnings: 500 },
        },
      ],
    })

    expect(results[0]).toMatchObject({
      id: 'kit-1',
      recentClicks: 6,
      recentConversions: 2,
      recentEarningsCents: 1800,
    })
    expect(results[1]).toMatchObject({
      id: 'kit-2',
      recentClicks: 2,
      recentConversions: 1,
      recentEarningsCents: 500,
    })
  })

  it('does not spread unattributed earnings across multiple kits', () => {
    const results = buildTopEarningKitsLast7d({
      kits: [
        {
          id: 'kit-1',
          title: 'Lisbon',
          slug: 'lisbon',
          viewCount: 100,
          clickCount: 20,
          conversionCount: 3,
          estimatedEarnings: 50,
        },
        {
          id: 'kit-2',
          title: 'Porto',
          slug: 'porto',
          viewCount: 80,
          clickCount: 9,
          conversionCount: 1,
          estimatedEarnings: 25,
        },
      ],
      clickGroups: [],
      commissionGroups: [
        {
          attributedTripKitId: null,
          _count: { attributedTripKitId: 0 },
          _sum: { creatorEarnings: 900 },
        },
      ],
    })

    expect(results[0].recentEarningsCents).toBe(0)
    expect(results[1].recentEarningsCents).toBe(0)
  })
})
