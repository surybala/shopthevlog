// Pure display helpers for the channel insights / content briefs feature.
// No side effects — all functions are deterministic transformations of input.
// Mirrors the shape of dashboardAnalytics.ts.

export type AnalysisStatus = 'PENDING' | 'QUEUED' | 'ANALYZING' | 'COMPLETE' | 'FAILED'

export type InsightTone = 'emerald' | 'amber' | 'rose' | 'slate'

export type InsightStatusDisplay = {
  label: string
  tone: InsightTone
  canTrigger: boolean
  description: string
}

export type ContentPattern = {
  channel_niche?: string
  creator_archetype?: string
  top_patterns?: string[]
  weak_patterns?: string[]
  content_strengths?: string[]
  content_gaps?: string[]
  recommended_formats?: string[]
}

export type AudienceDemand = {
  top_topics?: { topic: string; frequency: string; example_comment: string }[]
  recurring_questions?: string[]
  emotional_triggers?: string[]
  underserved_needs?: string[]
}

export type BriefStatus = 'IDEA' | 'FILMING' | 'PUBLISHED'

export type ContentBriefRow = {
  id: string
  title: string
  hookIdeas: unknown       // stored as JSON string in DB; parse before use
  contentOutline: unknown  // stored as JSON string in DB; parse before use
  trendSignal: string | null
  audienceSignal: string | null
  estimatedScore: number
  reasoning: string | null
  briefStatus: BriefStatus
  publishedVlogId: string | null
  createdAt: string | null
}

export type ParsedContentBrief = Omit<ContentBriefRow, 'hookIdeas' | 'contentOutline'> & {
  hookIdeas: string[]
  contentOutline: string[]
}

// ─── Status display ───────────────────────────────────────────────────────────

export function buildInsightStatusDisplay(status: AnalysisStatus | null): InsightStatusDisplay {
  switch (status) {
    case 'ANALYZING':
      return {
        label: 'Analyzing',
        tone: 'amber',
        canTrigger: false,
        description: 'Your channel is being analyzed. This usually takes 1–2 minutes.',
      }
    case 'QUEUED':
      return {
        label: 'Queued',
        tone: 'amber',
        canTrigger: false,
        description: 'Analysis is queued and will begin shortly.',
      }
    case 'COMPLETE':
      return {
        label: 'Ready',
        tone: 'emerald',
        canTrigger: true,
        description: 'Your insights and content briefs are ready.',
      }
    case 'FAILED':
      return {
        label: 'Failed',
        tone: 'rose',
        canTrigger: true,
        description: 'Analysis did not complete. You can try again.',
      }
    default:
      return {
        label: 'Not analyzed yet',
        tone: 'slate',
        canTrigger: true,
        description: 'Run your first channel analysis to get personalized content briefs.',
      }
  }
}

// ─── Brief helpers ────────────────────────────────────────────────────────────

export function parseBrief(row: ContentBriefRow): ParsedContentBrief {
  const parse = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === 'string')
          : []
      } catch {
        return []
      }
    }
    return []
  }
  return { ...row, hookIdeas: parse(row.hookIdeas), contentOutline: parse(row.contentOutline) }
}

export function rankBriefsByScore(briefs: ContentBriefRow[]): ParsedContentBrief[] {
  return briefs
    .map(parseBrief)
    .sort((a, b) => b.estimatedScore - a.estimatedScore)
}

// ─── Score badge ──────────────────────────────────────────────────────────────

export function scoreTone(score: number): InsightTone {
  if (score >= 70) return 'emerald'
  if (score >= 50) return 'amber'
  return 'slate'
}

export function scoreLabel(score: number): string {
  if (score >= 70) return 'High potential'
  if (score >= 50) return 'Solid candidate'
  return 'Worth exploring'
}

// ─── Benchmark badge ──────────────────────────────────────────────────────────

export type BenchmarkNote = {
  text: string
  show: boolean
}

export function buildBenchmarkNote(
  usedBenchmarks: boolean,
  benchmarkVideoCount: number,
): BenchmarkNote {
  if (!usedBenchmarks || benchmarkVideoCount <= 0) {
    return { show: false, text: '' }
  }
  return {
    show: true,
    text: `Analysis enriched with ${benchmarkVideoCount} top-performing videos from your niche`,
  }
}

// ─── Pattern helpers ──────────────────────────────────────────────────────────

export function parseTopPatterns(topPatterns: unknown): ContentPattern {
  if (!topPatterns) return {}
  if (typeof topPatterns === 'object' && !Array.isArray(topPatterns)) {
    return topPatterns as ContentPattern
  }
  if (typeof topPatterns === 'string') {
    try {
      return JSON.parse(topPatterns) as ContentPattern
    } catch {
      return {}
    }
  }
  return {}
}

export function parseAudienceDemands(audienceDemands: unknown): AudienceDemand {
  if (!audienceDemands) return {}
  if (typeof audienceDemands === 'object' && !Array.isArray(audienceDemands)) {
    return audienceDemands as AudienceDemand
  }
  if (typeof audienceDemands === 'string') {
    try {
      return JSON.parse(audienceDemands) as AudienceDemand
    } catch {
      return {}
    }
  }
  return {}
}

// ─── Brief status display ─────────────────────────────────────────────────────

export type BriefStatusDisplay = {
  label: string
  tone: InsightTone
  nextLabel: string
  nextStatus: BriefStatus
  canAdvance: boolean
}

export function buildBriefStatusDisplay(status: BriefStatus): BriefStatusDisplay {
  switch (status) {
    case 'FILMING':
      return {
        label: 'Filming',
        tone: 'amber',
        nextLabel: 'Mark published',
        nextStatus: 'PUBLISHED',
        canAdvance: true,
      }
    case 'PUBLISHED':
      return {
        label: 'Published',
        tone: 'emerald',
        nextLabel: '',
        nextStatus: 'PUBLISHED',
        canAdvance: false,
      }
    default:
      return {
        label: 'Idea',
        tone: 'slate',
        nextLabel: 'Start filming',
        nextStatus: 'FILMING',
        canAdvance: true,
      }
  }
}

// ─── Niche benchmark comparison ───────────────────────────────────────────────

export type NicheStats = {
  creatorAvgViews?: number
  nicheAvgViews?: number
  creatorEngagementRate?: number
  nicheEngagementRate?: number
  creatorUploadsPerMonth?: number
  nicheUploadsPerMonth?: number
}

export type NicheComparisonRow = {
  label: string
  creatorValue: string
  nicheValue: string
  delta: string
  ahead: boolean
}

export type NicheComparison = {
  rows: NicheComparisonRow[]
  show: boolean
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

function fmtFreq(n: number): string {
  return `${n.toFixed(1)}/mo`
}

function deltaPct(creator: number, niche: number): string {
  if (niche === 0) return '—'
  const d = ((creator - niche) / niche) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`
}

export function buildNicheComparison(nicheStats: unknown): NicheComparison {
  const stats = parseNicheStats(nicheStats)
  const rows: NicheComparisonRow[] = []

  if (stats.creatorAvgViews != null && stats.nicheAvgViews != null) {
    rows.push({
      label: 'Avg views / video',
      creatorValue: fmtViews(stats.creatorAvgViews),
      nicheValue: fmtViews(stats.nicheAvgViews),
      delta: deltaPct(stats.creatorAvgViews, stats.nicheAvgViews),
      ahead: stats.creatorAvgViews >= stats.nicheAvgViews,
    })
  }

  if (stats.creatorEngagementRate != null && stats.nicheEngagementRate != null) {
    rows.push({
      label: 'Engagement rate',
      creatorValue: fmtPct(stats.creatorEngagementRate),
      nicheValue: fmtPct(stats.nicheEngagementRate),
      delta: deltaPct(stats.creatorEngagementRate, stats.nicheEngagementRate),
      ahead: stats.creatorEngagementRate >= stats.nicheEngagementRate,
    })
  }

  if (stats.creatorUploadsPerMonth != null && stats.nicheUploadsPerMonth != null) {
    rows.push({
      label: 'Upload frequency',
      creatorValue: fmtFreq(stats.creatorUploadsPerMonth),
      nicheValue: fmtFreq(stats.nicheUploadsPerMonth),
      delta: deltaPct(stats.creatorUploadsPerMonth, stats.nicheUploadsPerMonth),
      ahead: stats.creatorUploadsPerMonth >= stats.nicheUploadsPerMonth,
    })
  }

  return { rows, show: rows.length > 0 }
}

export function parseNicheStats(nicheStats: unknown): NicheStats {
  if (!nicheStats) return {}
  if (typeof nicheStats === 'object' && !Array.isArray(nicheStats)) {
    return nicheStats as NicheStats
  }
  if (typeof nicheStats === 'string') {
    try {
      return JSON.parse(nicheStats) as NicheStats
    } catch {
      return {}
    }
  }
  return {}
}

// ─── Staleness detection ──────────────────────────────────────────────────────

export const STALE_THRESHOLD_DAYS = 21

export type StalenessNote = {
  show: boolean
  daysOld: number
  message: string
}

export function buildStalenessNote(analyzedAt: Date | string | null): StalenessNote {
  if (!analyzedAt) return { show: false, daysOld: 0, message: '' }
  const ms = Date.now() - new Date(analyzedAt).getTime()
  const daysOld = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (daysOld < STALE_THRESHOLD_DAYS) return { show: false, daysOld, message: '' }
  return {
    show: true,
    daysOld,
    message: `Your briefs are ${daysOld} days old — niches shift fast. Re-analyze to stay ahead.`,
  }
}
