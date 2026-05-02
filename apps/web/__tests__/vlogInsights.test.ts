import { describe, expect, it } from 'vitest'
import { buildCatalogVideoInsight, buildImportedVlogInsight } from '../lib/vlogInsights'

describe('vlog insights', () => {
  it('scores itinerary-rich videos as strong processing candidates', () => {
    const insight = buildCatalogVideoInsight({
      title: '10 Day Japan Itinerary | Where to stay, eat, and shop in Tokyo',
      description: 'A full travel guide with hotels, cafes, neighborhoods, and our exact route.',
    })

    expect(insight.score).toBeGreaterThanOrEqual(72)
    expect(insight.recommendation).toBe('Process next')
    expect(insight.primaryFit).toBe('Best for itinerary kits')
    expect(insight.chips.some((chip) => chip.label === 'Itinerary-friendly')).toBe(true)
    expect(insight.reasons.length).toBeGreaterThan(0)
  })

  it('pushes low-signal update videos down in priority', () => {
    const insight = buildCatalogVideoInsight({
      title: 'Channel update + Q&A',
      description: '',
    })

    expect(insight.score).toBeLessThanOrEqual(30)
    expect(insight.recommendation).toBe('Lower priority')
    expect(insight.reasons.some((reason) => reason.includes('update'))).toBe(true)
  })

  it('summarizes review-ready imported vlogs from actual opportunity counts', () => {
    const insight = buildImportedVlogInsight({
      title: 'Weekend in Amsterdam',
      description: 'Canal route, cafes, and boutique stays.',
      processingStatus: 'REVIEW_PENDING',
      opportunities: [
        { reviewState: 'UNREVIEWED', publishState: 'DRAFT', opportunityType: 'ITINERARY' },
        { reviewState: 'UNREVIEWED', publishState: 'DRAFT', opportunityType: 'PLACE' },
      ],
      tripKits: [],
    })

    expect(insight.recommendation).toBe('Review now')
    expect(insight.primaryFit).toBe('Review-ready opportunities')
    expect(insight.headline).toContain('2 opportunit')
  })

  it('shows friendly retry guidance for failed processing', () => {
    const insight = buildImportedVlogInsight({
      title: 'Tokyo food crawl',
      description: 'Ramen, coffee, and hotel picks.',
      processingStatus: 'FAILED',
      pipelineError: 'no_opportunities_extracted',
      tripKits: [],
      opportunities: [],
    })

    expect(insight.recommendation).toBe('Needs attention')
    expect(insight.headline).toContain('Trip Kit')
    expect(insight.primaryFit).toBe('Best for stays + food')
  })
})
