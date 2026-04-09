import { describe, expect, it } from 'vitest'
import { buildCreatorMemoryEntries, normalizeCreatorMemoryKey } from '@/lib/creatorMemory'

describe('creator memory helpers', () => {
  it('normalizes memory keys consistently', () => {
    expect(normalizeCreatorMemoryKey('Park Hyatt Tokyo!!')).toBe('park hyatt tokyo')
  })

  it('builds place-memory entries for approved and edited opportunities', () => {
    const approved = buildCreatorMemoryEntries(
      {
        title: 'Park Hyatt Tokyo',
        opportunityType: 'HOTEL',
        candidateEntity: {
          canonicalLabel: 'Park Hyatt Tokyo',
          rawLabel: 'Park Hyatt',
          entityType: 'PLACE',
        },
      },
      'APPROVED'
    )

    const edited = buildCreatorMemoryEntries(
      {
        title: 'Peak Design Travel Backpack',
        opportunityType: 'TRAVEL_PRODUCT',
        candidateEntity: {
          canonicalLabel: 'Peak Design Travel Backpack',
          rawLabel: 'Peak Design bag',
          entityType: 'PRODUCT',
        },
      },
      'EDITED',
      { title: 'Peak Design 45L Travel Backpack', description: null }
    )

    expect(approved.map((entry) => entry.memoryType)).toEqual(['ACCEPTED_PLACE', 'RECURRING_ITEM'])
    expect(edited.map((entry) => entry.memoryType)).toEqual(['ACCEPTED_PRODUCT', 'NAMING_PREFERENCE', 'RECURRING_ITEM'])
  })

  it('builds rejected memory entries without naming preferences', () => {
    const rejected = buildCreatorMemoryEntries(
      {
        title: 'Mystery Hotel',
        opportunityType: 'HOTEL',
        candidateEntity: {
          canonicalLabel: 'Mystery Hotel',
          rawLabel: 'Mystery Hotel',
          entityType: 'PLACE',
        },
      },
      'REJECTED'
    )

    expect(rejected).toEqual([
      {
        memoryType: 'REJECTED_PLACE',
        key: 'mystery hotel',
        valueJson: {
          sourceAction: 'REJECTED',
          opportunityType: 'HOTEL',
          title: 'Mystery Hotel',
        },
      },
    ])
  })
})
