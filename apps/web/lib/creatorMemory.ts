type MemorySeedOpportunity = {
  opportunityType: string
  title: string
  candidateEntity?: {
    canonicalLabel?: string | null
    rawLabel?: string | null
    entityType?: string | null
  } | null
}

export function normalizeCreatorMemoryKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function buildCreatorMemoryEntries(
  opportunity: MemorySeedOpportunity,
  action: 'APPROVED' | 'REJECTED' | 'EDITED',
  editedFields?: { title?: string | null; description?: string | null } | null,
) {
  const label = opportunity.candidateEntity?.canonicalLabel
    ?? opportunity.candidateEntity?.rawLabel
    ?? opportunity.title
  const key = normalizeCreatorMemoryKey(label)
  if (!key) return []

  const placeLikeOpportunityTypes = new Set(['HOTEL', 'RESTAURANT', 'CAFE', 'ATTRACTION', 'ACTIVITY', 'CITY_GUIDE', 'ITINERARY'])
  const entityType = opportunity.candidateEntity?.entityType ?? null
  const isPlaceLike = entityType === 'PLACE'
    || entityType === 'EXPERIENCE'
    || placeLikeOpportunityTypes.has(opportunity.opportunityType)

  const primaryMemoryType = action === 'REJECTED'
    ? 'REJECTED_PRODUCT'
    : (isPlaceLike ? 'ACCEPTED_PLACE' : 'ACCEPTED_PRODUCT')

  const entries = [
    {
      memoryType: primaryMemoryType,
      key,
      valueJson: {
        sourceAction: action,
        opportunityType: opportunity.opportunityType,
        title: opportunity.title,
      },
    },
  ]

  if (action === 'EDITED' && editedFields?.title?.trim()) {
    entries.push({
      memoryType: 'NAMING_PREFERENCE',
      key,
      valueJson: {
        preferredTitle: editedFields.title.trim(),
      },
    })
  }

  if (action === 'APPROVED' || action === 'EDITED') {
    entries.push({
      memoryType: 'RECURRING_ITEM',
      key,
      valueJson: {
        reinforcedBy: action,
      },
    })
  }

  return entries
}

export function buildCreatorMemoryHints(
  memoryRows: Array<{ memoryType: string; valueJson?: unknown }> | undefined,
) {
  if (!memoryRows || memoryRows.length === 0) return []

  const hints: string[] = []

  for (const memory of memoryRows) {
    switch (memory.memoryType) {
      case 'ACCEPTED_PLACE':
      case 'ACCEPTED_PRODUCT':
        hints.push('Previously approved')
        break
      case 'REJECTED_PRODUCT':
        hints.push('Previously rejected')
        break
      case 'NAMING_PREFERENCE': {
        const preferredTitle = typeof memory.valueJson === 'object'
          && memory.valueJson
          && 'preferredTitle' in memory.valueJson
          && typeof (memory.valueJson as { preferredTitle?: unknown }).preferredTitle === 'string'
          ? (memory.valueJson as { preferredTitle: string }).preferredTitle
          : null
        if (preferredTitle) {
          hints.push(`Preferred naming: ${preferredTitle}`)
        }
        break
      }
      case 'RECURRING_ITEM':
        hints.push('Recurring item')
        break
      default:
        break
    }
  }

  return Array.from(new Set(hints))
}
