type RecentKit = {
  id: string
  title: string
  slug: string
  viewCount: number
  clickCount: number
  conversionCount: number
  estimatedEarnings: number
}

type KitClickGroup = {
  tripKitId: string | null
  _count: { tripKitId: number }
}

type LinkCommissionGroup = {
  attributedTripKitId: string | null
  _count: { attributedTripKitId: number }
  _sum: { creatorEarnings: number | null }
}

export function formatCurrencyFromCents(cents: number) {
  return (cents / 100).toFixed(2)
}

export function buildRecentPerformanceSummary(input: {
  clicksLast7d: number
  conversionsLast7d: number
  earningsLast7dCents: number
}) {
  const conversionRate =
    input.clicksLast7d > 0 ? (input.conversionsLast7d / input.clicksLast7d) * 100 : 0

  return {
    ...input,
    conversionRate,
    earningsLast7dDisplay: formatCurrencyFromCents(input.earningsLast7dCents),
  }
}

export function buildTopEarningKitsLast7d(input: {
  kits: RecentKit[]
  clickGroups: KitClickGroup[]
  commissionGroups: LinkCommissionGroup[]
}) {
  const recentClicksByKit = new Map<string, number>()
  for (const group of input.clickGroups) {
    if (group.tripKitId) {
      recentClicksByKit.set(group.tripKitId, group._count.tripKitId)
    }
  }

  const recentEarningsByKit = new Map<string, number>()
  const recentConversionsByKit = new Map<string, number>()

  for (const group of input.commissionGroups) {
    if (group.attributedTripKitId) {
      const kitId = group.attributedTripKitId
      recentEarningsByKit.set(
        kitId,
        (recentEarningsByKit.get(kitId) ?? 0) + (group._sum.creatorEarnings ?? 0)
      )
      recentConversionsByKit.set(
        kitId,
        (recentConversionsByKit.get(kitId) ?? 0) + group._count.attributedTripKitId
      )
    }
  }

  return input.kits
    .map((kit) => ({
      ...kit,
      recentClicks: recentClicksByKit.get(kit.id) ?? 0,
      recentConversions: recentConversionsByKit.get(kit.id) ?? 0,
      recentEarningsCents: recentEarningsByKit.get(kit.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.recentEarningsCents !== a.recentEarningsCents) {
        return b.recentEarningsCents - a.recentEarningsCents
      }
      if (b.recentClicks !== a.recentClicks) {
        return b.recentClicks - a.recentClicks
      }
      return b.viewCount - a.viewCount
    })
}
