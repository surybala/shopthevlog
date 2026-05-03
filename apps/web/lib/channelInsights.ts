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

export type ContentBriefRow = {
  id: string
  title: string
  hookIdeas: unknown       // stored as JSON string in DB; parse before use
  contentOutline: unknown  // stored as JSON string in DB; parse before use
  trendSignal: string | null
  audienceSignal: string | null
  estimatedScore: number
  reasoning: string | null
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
