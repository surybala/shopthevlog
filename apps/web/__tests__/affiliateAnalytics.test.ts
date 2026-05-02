import { describe, expect, it } from 'vitest'
import {
  calculateConversionRate,
  earningsByProvider,
  sumCommissionEarnings,
  summarizeAffiliateLinks,
} from '@/lib/affiliateAnalytics'

describe('affiliate analytics helpers', () => {
  it('calculates conversion rate safely', () => {
    expect(calculateConversionRate(0, 3)).toBe(0)
    expect(calculateConversionRate(20, 5)).toBe(25)
  })

  it('summarizes affiliate links into totals and conversion rate', () => {
    expect(
      summarizeAffiliateLinks([
        { clickCount: 10, conversionCount: 2, totalEarnings: 15.5 },
        { clickCount: 5, conversionCount: 1, totalEarnings: 4.5 },
      ])
    ).toEqual({
      clicks: 15,
      conversions: 3,
      earnings: 20,
      conversionRate: 20,
    })
  })

  it('groups commission earnings by provider and sums totals', () => {
    const commissions = [
      { provider: 'STAY22', creatorEarnings: 1200 },
      { provider: 'STAY22', creatorEarnings: 800 },
      { provider: 'VIATOR', creatorEarnings: 400 },
    ]

    expect(earningsByProvider(commissions)).toEqual({
      STAY22: 2000,
      VIATOR: 400,
    })
    expect(sumCommissionEarnings(commissions)).toBe(2400)
  })
})
