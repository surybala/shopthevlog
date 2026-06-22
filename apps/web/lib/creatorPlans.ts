export type CreatorPlanKey = 'FREE' | 'PRO' | 'STUDIO'

export const CREATOR_PLAN_CONFIG = {
  FREE: {
    label: 'Free',
    price: '$0/mo',
    description: 'Up to 3 Trip Kits, 50 imported videos, and 3 processing credits each month',
    maxImportedVlogs: 50,
    monthlyProcessingCredits: 3,
  },
  PRO: {
    label: 'Pro',
    price: '$49/mo',
    description: 'Up to 25 imported videos, 20 processing credits each month, AI scan, and advanced analytics',
    maxImportedVlogs: 25,
    monthlyProcessingCredits: 20,
  },
  STUDIO: {
    label: 'Studio',
    price: '$199/mo',
    description: 'Up to 100 imported videos, 75 processing credits each month, team seats, and premium support',
    maxImportedVlogs: 100,
    monthlyProcessingCredits: 75,
  },
} as const satisfies Record<CreatorPlanKey, {
  label: string
  price: string
  description: string
  maxImportedVlogs: number
  monthlyProcessingCredits: number
}>

export function getCreatorPlanConfig(plan: string | null | undefined) {
  if (plan === 'PRO' || plan === 'STUDIO') return CREATOR_PLAN_CONFIG[plan]
  return CREATOR_PLAN_CONFIG.FREE
}
