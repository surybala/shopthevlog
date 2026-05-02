import { getCreatorPlanConfig } from '@/lib/creatorPlans'

export type CreatorQuotaSnapshot = {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  shouldPersistReset: boolean
}

function getCalendarMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

function getNextCalendarMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

export function getCreatorProcessingQuotaSnapshot({
  plan,
  used,
  resetAt,
  now = new Date(),
}: {
  plan: string | null | undefined
  used: number | null | undefined
  resetAt: Date | string | null | undefined
  now?: Date
}): CreatorQuotaSnapshot {
  const { monthlyProcessingCredits } = getCreatorPlanConfig(plan)
  const monthStart = getCalendarMonthStart(now)
  const normalizedResetAt = resetAt ? new Date(resetAt) : null
  const shouldPersistReset = !normalizedResetAt || normalizedResetAt.getTime() < monthStart.getTime()
  const normalizedUsed = shouldPersistReset ? 0 : Math.max(used ?? 0, 0)

  return {
    limit: monthlyProcessingCredits,
    used: normalizedUsed,
    remaining: Math.max(monthlyProcessingCredits - normalizedUsed, 0),
    resetAt: getNextCalendarMonthStart(now),
    shouldPersistReset,
  }
}
