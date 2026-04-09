type ReviewableOpportunity = {
  id: string
  title: string
  opportunityType: string
  reviewState: string
  publishState: string
  confidence: number
  rankScore: number | null
  metadataJson?: unknown
  evidences?: Array<{
    evidence: {
      sourceType: string
      startSec: number
      endSec: number
    }
  }>
}

export function formatOpportunityTypeLabel(opportunityType: string) {
  return opportunityType
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function summarizeEvidenceSources(opportunity: ReviewableOpportunity) {
  const sourceTypes = Array.from(
    new Set((opportunity.evidences ?? []).map((entry) => entry.evidence.sourceType))
  )

  if (sourceTypes.length === 0) {
    return 'No evidence linked yet'
  }

  return sourceTypes
    .map((sourceType) =>
      sourceType
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    )
    .join(', ')
}

export function buildOpportunityReviewSummary(opportunities: ReviewableOpportunity[]) {
  const pending = opportunities.filter((opportunity) => opportunity.reviewState === 'UNREVIEWED').length
  const autoApproved = opportunities.filter((opportunity) => opportunity.reviewState === 'AUTO_APPROVED').length
  const approved = opportunities.filter((opportunity) =>
    opportunity.reviewState === 'APPROVED' || opportunity.reviewState === 'EDITED'
  ).length
  const suppressed = opportunities.filter((opportunity) => opportunity.publishState === 'SUPPRESSED').length

  return {
    total: opportunities.length,
    pending,
    autoApproved,
    approved,
    suppressed,
  }
}

export function rankReviewQueue<T extends ReviewableOpportunity>(opportunities: T[]) {
  return [...opportunities].sort((left, right) => {
    const reviewPriority = reviewStatePriority(right.reviewState) - reviewStatePriority(left.reviewState)
    if (reviewPriority !== 0) return reviewPriority

    const rankDelta = (right.rankScore ?? -1) - (left.rankScore ?? -1)
    if (rankDelta !== 0) return rankDelta

    const recommendationDelta = reviewRecommendationPriority(getReviewRecommendation(right))
      - reviewRecommendationPriority(getReviewRecommendation(left))
    if (recommendationDelta !== 0) return recommendationDelta

    return right.confidence - left.confidence
  })
}

export function getReviewRecommendation(opportunity: Pick<ReviewableOpportunity, 'metadataJson'>) {
  if (!opportunity.metadataJson || typeof opportunity.metadataJson !== 'object') {
    return null
  }

  const recommendation = (opportunity.metadataJson as { reviewRecommendation?: unknown }).reviewRecommendation
  return typeof recommendation === 'string' ? recommendation : null
}

export function getReviewRecommendationReason(opportunity: Pick<ReviewableOpportunity, 'metadataJson'>) {
  if (!opportunity.metadataJson || typeof opportunity.metadataJson !== 'object') {
    return null
  }

  const reason = (opportunity.metadataJson as { reviewRecommendationReason?: unknown }).reviewRecommendationReason
  return typeof reason === 'string' ? reason : null
}

export function formatReviewRecommendationLabel(recommendation: string | null) {
  switch (recommendation) {
    case 'auto_approved_from_memory':
      return 'Auto-approved from memory'
    case 'needs_scrutiny':
      return 'Needs scrutiny'
    case 'likely_approve':
      return 'Likely approve'
    case 'strong_candidate':
      return 'Strong candidate'
    case 'preserved_review_state':
      return 'Previously reviewed'
    case 'standard_review':
      return 'Standard review'
    default:
      return null
  }
}

export function reviewRecommendationTone(recommendation: string | null) {
  switch (recommendation) {
    case 'needs_scrutiny':
      return 'border-red-500/20 bg-red-500/10 text-red-200'
    case 'likely_approve':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    case 'strong_candidate':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
    case 'auto_approved_from_memory':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-200'
    case 'preserved_review_state':
      return 'border-white/10 bg-white/5 text-white/60'
    default:
      return 'border-white/10 bg-white/5 text-white/50'
  }
}

function reviewStatePriority(reviewState: string) {
  switch (reviewState) {
    case 'UNREVIEWED':
      return 4
    case 'AUTO_APPROVED':
      return 3
    case 'EDITED':
      return 2
    case 'APPROVED':
      return 1
    default:
      return 0
  }
}

function reviewRecommendationPriority(recommendation: string | null) {
  switch (recommendation) {
    case 'needs_scrutiny':
      return 4
    case 'strong_candidate':
      return 3
    case 'likely_approve':
      return 2
    case 'auto_approved_from_memory':
      return 1
    default:
      return 0
  }
}
