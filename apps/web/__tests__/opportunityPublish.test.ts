import { describe, expect, it } from 'vitest'
import {
  buildTripKitPublishSummary,
  buildTripKitSlug,
  normalizeActivityType,
  selectPublishableItineraryOpportunity,
} from '@/lib/opportunityPublish'

describe('opportunity publish helpers', () => {
  it('selects the latest draft-ready itinerary opportunity for publishing', () => {
    const selected = selectPublishableItineraryOpportunity([
      {
        id: 'opp-1',
        title: 'Older itinerary',
        description: null,
        reviewState: 'APPROVED',
        publishState: 'PUBLISHED',
        metadataJson: { itinerary: { title: 'Older itinerary', days: [] } },
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        id: 'opp-2',
        title: 'Fresh itinerary',
        description: 'Updated from review',
        reviewState: 'EDITED',
        publishState: 'DRAFT',
        metadataJson: {
          itinerary: {
            title: 'Fresh itinerary',
            destinations: ['Tokyo'],
            countries: ['Japan'],
            days: [{ day_number: 1, activities: [{ title: 'Park Hyatt Tokyo' }] }],
          },
        },
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    ])

    expect(selected?.id).toBe('opp-2')
  })

  it('builds a publish preview for a Trip Kit projection', () => {
    const summary = buildTripKitPublishSummary({
      creatorId: 'creator-1',
      existingTripKit: {
        id: 'kit-1',
        title: 'Tokyo Draft',
        slug: 'tokyo-draft-abc123',
        isPublished: true,
        primaryCity: 'Kyoto',
        durationDays: 1,
        days: [{ id: 'day-1', activities: [{ id: 'act-1' }] }],
      },
      opportunities: [
        {
          id: 'opp-2',
          title: 'Fresh itinerary',
          description: 'Updated from review',
          reviewState: 'EDITED',
          publishState: 'DRAFT',
          metadataJson: {
            itinerary: {
              title: '5 Days in Tokyo',
              destinations: ['Tokyo'],
              countries: ['Japan'],
              primary_city: 'Tokyo',
              estimated_budget_usd: 2000,
              days: [
                { day_number: 1, activities: [{ title: 'Park Hyatt Tokyo' }, { title: 'Golden Gai' }] },
                { day_number: 2, activities: [{ title: 'Shibuya Crossing' }] },
              ],
            },
          },
          createdAt: new Date('2026-04-02T00:00:00.000Z'),
          updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        },
      ],
    })

    expect(summary.readyToPublish).toBe(true)
    expect(summary.actionLabel).toBe('Republish Trip Kit')
    expect(summary.totalDays).toBe(2)
    expect(summary.totalActivities).toBe(3)
    expect(summary.itinerary?.slug).toBe(buildTripKitSlug('5 Days in Tokyo', 'creator-1'))
    expect(summary.republishChanges).toContain('Title will change from "Tokyo Draft" to "5 Days in Tokyo"')
    expect(summary.republishChanges).toContain('Primary destination will change to Tokyo')
    expect(summary.republishChanges).toContain('Day count will change from 1 to 2')
    expect(summary.republishChanges).toContain('Activity count will change from 1 to 3')
  })

  it('normalizes unknown activity types safely', () => {
    expect(normalizeActivityType('FOOD')).toBe('FOOD')
    expect(normalizeActivityType('SURPRISE')).toBe('OTHER')
  })
})
