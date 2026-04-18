export function centsToDollars(cents: number) {
  return cents / 100
}

export function formatUsdFromCents(cents: number) {
  return `$${centsToDollars(cents).toFixed(2)}`
}

export function getNextMonthlyPayoutDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1)
}

export function summarizeCommissionStatus(
  commissions: Array<{ creatorEarnings: number; status: string }>,
) {
  return commissions.reduce(
    (acc, commission) => {
      if (commission.status === 'PENDING') acc.pending += commission.creatorEarnings
      if (commission.status === 'CONFIRMED') acc.confirmed += commission.creatorEarnings
      if (commission.status === 'PAID') acc.paid += commission.creatorEarnings
      if (commission.status === 'REVERSED') acc.reversed += commission.creatorEarnings
      return acc
    },
    { pending: 0, confirmed: 0, paid: 0, reversed: 0 },
  )
}

export function calculateSubscriberRunRate(
  subscriptions: Array<{
    billingPeriod: 'MONTHLY' | 'YEARLY'
    tier: { monthlyPrice: number; yearlyPrice?: number | null }
  }>,
) {
  return subscriptions.reduce((total, subscription) => {
    if (subscription.billingPeriod === 'YEARLY' && subscription.tier.yearlyPrice) {
      return total + Math.round(subscription.tier.yearlyPrice / 12)
    }
    return total + subscription.tier.monthlyPrice
  }, 0)
}
