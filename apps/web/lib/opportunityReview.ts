type ReviewableOpportunity = {
  id: string
  title: string
  opportunityType: string
  reviewState: string
  publishState: string
  confidence: number
  rankScore: number | null
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

    return right.confidence - left.confidence
  })
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
