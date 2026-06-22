export type CreatorPlanKey = 'FREE' | 'PRO' | 'STUDIO'

export const CREATOR_PLAN_CONFIG = {
  FREE: {
    label: 'Free',
    price: '$0/mo',
    description: 'Up to 3 Trip Kits, 50 imported videos, and 3 processing credits each month',
    maxImportedVlogs: 50,
    monthlyProcessingCredits: 3,
    ideaWorkshopDailyLimit: 10,
  },
  PRO: {
    label: 'Pro',
    price: '$49/mo',
    description: 'Up to 200 imported videos, 20 processing credits each month, AI scan, and advanced analytics',
    maxImportedVlogs: 200,
    monthlyProcessingCredits: 20,
    ideaWorkshopDailyLimit: 100,
  },
  STUDIO: {
    label: 'Studio',
    price: '$199/mo',
    description: 'Up to 1000 imported videos, 75 processing credits each month, team seats, and premium support',
    maxImportedVlogs: 1000,
    monthlyProcessingCredits: 75,
    ideaWorkshopDailyLimit: 500,
  },
} as const satisfies Record<CreatorPlanKey, {
  label: string
  price: string
  description: string
  maxImportedVlogs: number
  monthlyProcessingCredits: number
  ideaWorkshopDailyLimit: number
}>

// How many of the creator's most-recent videos we auto-import the first time
// they connect YouTube. Enough to read niche, personal style, and performance
// patterns (the analysis pipeline reads the top/bottom of ~30) without ingesting
// an entire back-catalogue. Always bounded by the plan's import cap.
export const DEFAULT_AUTO_IMPORT_COUNT = 30

// How many freshly imported videos to auto-transcribe on first import.
// 0 = none (default): transcription is credit-gated and the scarce signal it adds
// is "personal style", which is not required for the first niche/performance read.
// Bump to e.g. 5 to seed the first analysis with voice/style from the creator's
// top recent videos (costs that many processing credits per creator).
export const AUTO_TRANSCRIBE_TOP_N = 0

export function getCreatorPlanConfig(plan: string | null | undefined) {
  if (plan === 'PRO' || plan === 'STUDIO') return CREATOR_PLAN_CONFIG[plan]
  return CREATOR_PLAN_CONFIG.FREE
}

// The default automatic import size for a plan, never exceeding its hard cap.
export function resolveAutoImportCount(plan: string | null | undefined): number {
  return Math.min(DEFAULT_AUTO_IMPORT_COUNT, getCreatorPlanConfig(plan).maxImportedVlogs)
}

// Pick which freshly imported videos to auto-transcribe: the top `topN` by view
// count (most representative of the creator's voice). Returns [] when disabled.
export function selectVlogIdsForAutoTranscription<
  T extends { videoId: string; viewCount: number | null },
>(vlogs: T[], topN: number = AUTO_TRANSCRIBE_TOP_N): string[] {
  if (topN <= 0) return []
  return [...vlogs]
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    .slice(0, topN)
    .map((v) => v.videoId)
}
