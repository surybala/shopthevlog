type LinkSummary = {
  clickCount: number
  conversionCount: number
  totalEarnings: number
}

type ProviderCommission = {
  provider: string
  creatorEarnings: number
}

export function calculateConversionRate(clicks: number, conversions: number): number {
  if (clicks <= 0) return 0
  return (conversions / clicks) * 100
}

export function summarizeAffiliateLinks<T extends LinkSummary>(links: T[]) {
  const totals = links.reduce(
    (acc, link) => ({
      clicks: acc.clicks + link.clickCount,
      conversions: acc.conversions + link.conversionCount,
      earnings: acc.earnings + link.totalEarnings,
    }),
    { clicks: 0, conversions: 0, earnings: 0 }
  )

  return {
    ...totals,
    conversionRate: calculateConversionRate(totals.clicks, totals.conversions),
  }
}

export function earningsByProvider<T extends ProviderCommission>(commissions: T[]) {
  return commissions.reduce<Record<string, number>>((acc, commission) => {
    acc[commission.provider] = (acc[commission.provider] ?? 0) + commission.creatorEarnings
    return acc
  }, {})
}

export function sumCommissionEarnings<T extends { creatorEarnings: number }>(commissions: T[]) {
  return commissions.reduce((total, commission) => total + commission.creatorEarnings, 0)
}
