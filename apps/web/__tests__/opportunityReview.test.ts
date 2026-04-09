import { describe, expect, it } from 'vitest'
import {
  buildOpportunityReviewSummary,
  formatReviewRecommendationLabel,
  formatOpportunityTypeLabel,
  getReviewRecommendation,
  getReviewRecommendationReason,
  rankReviewQueue,
  reviewRecommendationTone,
  summarizeEvidenceSources,
} from '@/lib/opportunityReview'

describe('opportunity review helpers', () => {
  it('formats opportunity types and evidence source labels', () => {
    expect(formatOpportunityTypeLabel('TRAVEL_PRODUCT')).toBe('Travel Product')
    expect(
      summarizeEvidenceSources({
        id: 'opp-1',
        title: 'Park Hyatt Tokyo',
        opportunityType: 'HOTEL',
        reviewState: 'UNREVIEWED',
        publishState: 'DRAFT',
        confidence: 0.92,
        rankScore: 0.88,
        evidences: [
          { evidence: { sourceType: 'TRANSCRIPT', startSec: 10, endSec: 40 } },
          { evidence: { sourceType: 'SCENE_SUMMARY', startSec: 15, endSec: 45 } },
        ],
      })
    ).toBe('Transcript, Scene Summary')
  })

  it('builds summary totals and review ordering', () => {
    const opportunities = [
      { id: '1', title: 'One', opportunityType: 'HOTEL', reviewState: 'APPROVED', publishState: 'DRAFT', confidence: 0.7, rankScore: 0.8, evidences: [], metadataJson: {} },
      { id: '2', title: 'Two', opportunityType: 'ITINERARY', reviewState: 'UNREVIEWED', publishState: 'DRAFT', confidence: 0.6, rankScore: 0.5, evidences: [], metadataJson: { reviewRecommendation: 'likely_approve' } },
      { id: '3', title: 'Three', opportunityType: 'CAFE', reviewState: 'AUTO_APPROVED', publishState: 'DRAFT', confidence: 0.9, rankScore: 0.7, evidences: [], metadataJson: {} },
      { id: '4', title: 'Four', opportunityType: 'ACTIVITY', reviewState: 'REJECTED', publishState: 'SUPPRESSED', confidence: 0.4, rankScore: 0.2, evidences: [], metadataJson: {} },
      { id: '5', title: 'Five', opportunityType: 'HOTEL', reviewState: 'UNREVIEWED', publishState: 'DRAFT', confidence: 0.55, rankScore: 0.5, evidences: [], metadataJson: { reviewRecommendation: 'needs_scrutiny' } },
    ]

    expect(buildOpportunityReviewSummary(opportunities)).toEqual({
      total: 5,
      pending: 2,
      autoApproved: 1,
      approved: 1,
      suppressed: 1,
    })

    expect(rankReviewQueue(opportunities).map((opportunity) => opportunity.id)).toEqual(['5', '2', '3', '1', '4'])
  })

  it('reads and formats recommendation metadata for the queue UI', () => {
    const opportunity = {
      id: 'opp-1',
      title: 'Park Hyatt Tokyo',
      opportunityType: 'HOTEL',
      reviewState: 'UNREVIEWED',
      publishState: 'DRAFT',
      confidence: 0.92,
      rankScore: 0.88,
      metadataJson: {
        reviewRecommendation: 'needs_scrutiny',
        reviewRecommendationReason: 'Creator history shows a similar item was rejected before, so this should be reviewed manually.',
      },
      evidences: [],
    }

    expect(getReviewRecommendation(opportunity)).toBe('needs_scrutiny')
    expect(getReviewRecommendationReason(opportunity)).toContain('rejected before')
    expect(formatReviewRecommendationLabel('needs_scrutiny')).toBe('Needs scrutiny')
    expect(reviewRecommendationTone('needs_scrutiny')).toContain('text-red-200')
  })
})
