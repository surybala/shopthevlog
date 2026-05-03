import { formatVlogPipelineErrorMessage } from '@/lib/vlogProcessing'

type Tone = 'emerald' | 'amber' | 'rose' | 'slate'

export type InsightChip = {
  label: string
  tone: Tone
}

export type CatalogVideoLike = {
  title: string
  description?: string | null
  publishedAt?: string | Date | null
}

export type ImportedVlogLike = CatalogVideoLike & {
  processingStatus: string
  pipelineError?: string | null
  processedAt?: string | Date | null
  tripKits?: { tripKit: { isPublished: boolean } }[]
  opportunities?: {
    reviewState?: string
    publishState?: string
    opportunityType?: string
  }[]
}

export type ProcessingInsight = {
  score: number
  headline: string
  recommendation: string
  primaryFit: string
  chips: InsightChip[]
  reasons: string[]
}

const STRONG_TRAVEL_PATTERNS = [
  /\bitinerary\b/i,
  /\btravel guide\b/i,
  /\bwhere to stay\b/i,
  /\bthings to do\b/i,
  /\bweekend in\b/i,
  /\b(\d+)[-\s]day\b/i,
  /\broad trip\b/i,
  /\bguide to\b/i,
]

const DESTINATION_PATTERNS = [/\bin\s+[A-Z][a-z]+/g, /\bto\s+[A-Z][a-z]+/g]

const STAY_FOOD_PATTERNS = [
  /\bhotel\b/i,
  /\bresort\b/i,
  /\bairbnb\b/i,
  /\brestaurant\b/i,
  /\bcafe\b/i,
  /\bfood\b/i,
  /\beat\b/i,
]

const PACKING_SHOPPING_PATTERNS = [
  /\bpack(?:ing)?\b/i,
  /\bwhat i brought\b/i,
  /\bessentials\b/i,
  /\bgear\b/i,
  /\bamazon\b/i,
  /\bshopping\b/i,
]

const LOW_SIGNAL_PATTERNS = [
  /\bq&a\b/i,
  /\bpodcast\b/i,
  /\blive stream\b/i,
  /\bannouncement\b/i,
  /\bchannel update\b/i,
  /\btest\b/i,
]

function scoreTextPatterns(text: string, patterns: RegExp[], points: number) {
  return patterns.some((pattern) => pattern.test(text)) ? points : 0
}

function countPatternHits(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

function derivePrimaryFit(itineraryPoints: number, stayFoodPoints: number, packingPoints: number) {
  if (itineraryPoints >= stayFoodPoints && itineraryPoints >= packingPoints && itineraryPoints > 0) {
    return 'Best for itinerary kits'
  }
  if (stayFoodPoints >= packingPoints && stayFoodPoints > 0) {
    return 'Best for stays + food'
  }
  if (packingPoints > 0) {
    return 'Best for packing + products'
  }
  return 'General trip kit'
}

export function buildCatalogVideoInsight(video: CatalogVideoLike): ProcessingInsight {
  const title = video.title ?? ''
  const description = video.description ?? ''
  const combined = `${title}\n${description}`.trim()
  const lower = combined.toLowerCase()

  let score = 26
  const chips: InsightChip[] = []
  const reasons: string[] = []
  let itineraryPoints = 0
  let stayFoodPoints = 0
  let packingPoints = 0

  const strongTravel = scoreTextPatterns(combined, STRONG_TRAVEL_PATTERNS, 30)
  if (strongTravel) {
    chips.push({ label: 'Itinerary-friendly', tone: 'emerald' })
    reasons.push('Clear itinerary or guide language')
    itineraryPoints += strongTravel
    score += strongTravel
  }

  const stayFood = scoreTextPatterns(combined, STAY_FOOD_PATTERNS, 18)
  if (stayFood) {
    chips.push({ label: 'Stay + food signal', tone: 'emerald' })
    reasons.push('Mentions stays, restaurants, or food stops')
    stayFoodPoints += stayFood
    score += stayFood
  }

  const packingShopping = scoreTextPatterns(combined, PACKING_SHOPPING_PATTERNS, 16)
  if (packingShopping) {
    chips.push({ label: 'Packing / product signal', tone: 'amber' })
    reasons.push('Looks useful for packing lists or product picks')
    packingPoints += packingShopping
    score += packingShopping
  }

  const destinationMentions = countPatternHits(title, DESTINATION_PATTERNS)
  if (destinationMentions > 0) {
    chips.push({ label: 'Destination-led', tone: 'emerald' })
    reasons.push('Destination appears in the title')
    itineraryPoints += 12
    score += 12
  }

  if (title.length >= 34) {
    reasons.push('Specific title gives the pipeline more context')
    score += 6
  }

  if (description.length >= 180) {
    chips.push({ label: 'Rich description', tone: 'slate' })
    reasons.push('Description adds useful detail for extraction')
    score += 6
  }

  if (!description.trim()) {
    reasons.push('Limited description makes extraction less certain')
    score -= 8
  }

  if (title.trim().split(/\s+/).length <= 3) {
    reasons.push('Very short title lowers confidence')
    score -= 10
  }

  const lowSignal = scoreTextPatterns(lower, LOW_SIGNAL_PATTERNS, 22)
  if (lowSignal) {
    score -= lowSignal
    chips.push({ label: 'Lower travel intent', tone: 'rose' })
    reasons.push('Title reads more like an update than a trip guide')
  }

  score = Math.max(5, Math.min(96, score))

  let headline = 'Worth trying once credits open up.'
  let recommendation = 'Worth trying'

  if (score >= 72) {
    headline = 'Strong travel-kit potential with clear creator review value.'
    recommendation = 'Process next'
  } else if (score >= 55) {
    headline = 'Likely to produce useful places, stays, or packing opportunities.'
    recommendation = 'Good candidate'
  } else if (score <= 30) {
    headline = 'Lower signal for a strong Trip Kit. Save credits unless it matters strategically.'
    recommendation = 'Lower priority'
  }

  if (chips.length === 0) {
    chips.push({ label: 'Needs manual judgment', tone: 'slate' })
    reasons.push('Metadata alone is not enough to judge this one confidently')
  }

  return {
    score,
    headline,
    recommendation,
    primaryFit: derivePrimaryFit(itineraryPoints, stayFoodPoints, packingPoints),
    chips: chips.slice(0, 3),
    reasons: reasons.slice(0, 3),
  }
}

export function buildImportedVlogInsight(vlog: ImportedVlogLike): ProcessingInsight {
  const base = buildCatalogVideoInsight(vlog)
  const opportunities = vlog.opportunities ?? []
  const draftOpportunities = opportunities.filter((item) => item.publishState !== 'ARCHIVED')
  const reviewable = opportunities.filter((item) => item.reviewState === 'UNREVIEWED')
  const published = vlog.tripKits?.some((item) => item.tripKit.isPublished) ?? false

  if (published) {
    return {
      score: 100,
      headline: 'Live on the creator portal and ready to keep driving subscriber traffic.',
      recommendation: 'Published',
      primaryFit: 'Live creator portal kit',
      chips: [
        { label: 'Creator Portal live', tone: 'emerald' },
        { label: `${draftOpportunities.length} opportunity${draftOpportunities.length === 1 ? '' : 'ies'} converted`, tone: 'slate' },
      ],
      reasons: ['Already published and serving subscriber traffic'],
    }
  }

  if (vlog.processingStatus === 'REVIEW_PENDING') {
    return {
      score: 92,
      headline:
        reviewable.length > 0
          ? `${reviewable.length} opportunit${reviewable.length === 1 ? 'y is' : 'ies are'} ready for review.`
          : `${draftOpportunities.length} opportunit${draftOpportunities.length === 1 ? 'y is' : 'ies are'} ready for creator approval.`,
      recommendation: 'Review now',
      primaryFit: 'Review-ready opportunities',
      chips: [
        { label: 'Review ready', tone: 'emerald' },
        { label: `${draftOpportunities.length} found`, tone: 'slate' },
      ],
      reasons: [`${draftOpportunities.length} opportunit${draftOpportunities.length === 1 ? 'y was' : 'ies were'} generated`],
    }
  }

  if (vlog.processingStatus === 'FAILED') {
    return {
      score: 24,
      headline: formatVlogPipelineErrorMessage(vlog.pipelineError) ?? 'Video processing did not complete.',
      recommendation: 'Needs attention',
      primaryFit: base.primaryFit,
      chips: [
        { label: 'Retry needed', tone: 'rose' },
        ...(base.chips[0] ? [base.chips[0]] : []),
      ],
      reasons: ['The last processing run did not complete cleanly', ...base.reasons].slice(0, 3),
    }
  }

  if (['QUEUED', 'TRANSCRIBING', 'EXTRACTING', 'EMBEDDING'].includes(vlog.processingStatus)) {
    return {
      score: 68,
      headline: 'Processing is underway. We’ll update this row as soon as the reviewable output is ready.',
      recommendation: 'In progress',
      primaryFit: base.primaryFit,
      chips: [
        { label: 'Processing', tone: 'amber' },
        ...(base.chips[0] ? [base.chips[0]] : []),
      ],
      reasons: ['This video is currently moving through the AI pipeline', ...base.reasons].slice(0, 3),
    }
  }

  if (draftOpportunities.length > 0) {
    return {
      score: 82,
      headline: `${draftOpportunities.length} opportunit${draftOpportunities.length === 1 ? 'y was' : 'ies were'} generated from this video.`,
      recommendation: 'Review soon',
      primaryFit: base.primaryFit,
      chips: [
        { label: `${draftOpportunities.length} found`, tone: 'emerald' },
        ...(base.chips[0] ? [base.chips[0]] : []),
      ],
      reasons: [`${draftOpportunities.length} draft opportunit${draftOpportunities.length === 1 ? 'y is' : 'ies are'} already available`, ...base.reasons].slice(0, 3),
    }
  }

  if (vlog.processingStatus === 'PENDING') {
    return {
      score: base.score,
      headline: base.headline,
      recommendation: base.recommendation,
      primaryFit: base.primaryFit,
      chips: base.chips,
      reasons: base.reasons,
    }
  }

  return base
}
