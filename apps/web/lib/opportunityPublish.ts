import { createHash } from 'crypto'

type PublishableActivity = {
  sort_order?: number
  type?: string
  time?: string | null
  title?: string
  description?: string | null
  image_url?: string | null
  latitude?: number | null
  longitude?: number | null
}

type PublishableDay = {
  day_number?: number
  title?: string
  summary?: string | null
  city?: string | null
  country?: string | null
  tips?: string[]
  activities?: PublishableActivity[]
}

type ItineraryBlueprint = {
  title?: string
  summary?: string | null
  total_days?: number | null
  destinations?: string[]
  countries?: string[]
  primary_city?: string | null
  estimated_budget_usd?: number | null
  days?: PublishableDay[]
}

type PublishableOpportunity = {
  id: string
  title: string
  description: string | null
  reviewState: string
  publishState: string
  metadataJson: unknown
  createdAt?: Date
  updatedAt?: Date
}

type ExistingTripKit = {
  id: string
  title: string
  slug: string
  isPublished: boolean
  primaryCity?: string | null
  durationDays?: number | null
  days?: Array<{
    id?: string
    activities?: Array<{ id?: string }>
  }>
}

export function buildTripKitSlug(title: string, creatorId: string) {
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '')

  if (!base) base = 'trip-kit'

  const suffix = createHash('md5').update(`${creatorId}${title}`).digest('hex').slice(0, 6)
  return `${base}-${suffix}`
}

export function normalizeActivityType(type: string | undefined) {
  const validTypes = new Set([
    'ACCOMMODATION',
    'FOOD',
    'TOUR',
    'ADVENTURE',
    'CULTURAL',
    'WELLNESS',
    'NIGHTLIFE',
    'TRANSPORT',
    'ATTRACTION',
    'OTHER',
  ])

  return validTypes.has(type ?? '') ? (type as string) : 'OTHER'
}

export function getItineraryBlueprint(opportunity: Pick<PublishableOpportunity, 'metadataJson'>) {
  if (!opportunity.metadataJson || typeof opportunity.metadataJson !== 'object') {
    return null
  }

  const itinerary = (opportunity.metadataJson as { itinerary?: unknown }).itinerary
  if (!itinerary || typeof itinerary !== 'object') return null
  return itinerary as ItineraryBlueprint
}

export function selectPublishableItineraryOpportunity(opportunities: PublishableOpportunity[]) {
  return [...opportunities]
    .filter((opportunity) =>
      ['APPROVED', 'AUTO_APPROVED', 'EDITED'].includes(opportunity.reviewState)
      && opportunity.publishState !== 'SUPPRESSED'
      && getItineraryBlueprint(opportunity)
    )
    .sort((left, right) => {
      const publishedDelta = publishPriority(right.publishState) - publishPriority(left.publishState)
      if (publishedDelta !== 0) return publishedDelta

      const updatedDelta = (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0)
      if (updatedDelta !== 0) return updatedDelta

      return (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0)
    })[0] ?? null
}

export function buildTripKitPublishSummary(input: {
  creatorId: string
  opportunities: PublishableOpportunity[]
  existingTripKit?: ExistingTripKit | null
}) {
  const opportunity = selectPublishableItineraryOpportunity(input.opportunities)
  if (!opportunity) {
    return {
      readyToPublish: false,
      actionLabel: input.existingTripKit ? 'Republish Trip Kit' : 'Publish Trip Kit',
      tripKit: input.existingTripKit ?? null,
      opportunity: null,
      itinerary: null,
      totalDays: 0,
      totalActivities: 0,
      republishChanges: [],
    }
  }

  const itinerary = getItineraryBlueprint(opportunity)
  const title = itinerary?.title || opportunity.title
  const totalDays = itinerary?.days?.length ?? itinerary?.total_days ?? 0
  const totalActivities = (itinerary?.days ?? []).reduce((sum, day) => sum + (day.activities?.length ?? 0), 0)
  const preview = {
    title,
    summary: itinerary?.summary || opportunity.description,
    slug: buildTripKitSlug(title, input.creatorId),
    destinations: itinerary?.destinations ?? [],
    countries: itinerary?.countries ?? [],
    primaryCity: itinerary?.primary_city ?? itinerary?.destinations?.[0] ?? null,
    estimatedBudgetUsd: itinerary?.estimated_budget_usd ?? null,
  }

  return {
    readyToPublish: true,
    actionLabel: input.existingTripKit ? 'Republish Trip Kit' : 'Publish Trip Kit',
    tripKit: input.existingTripKit ?? null,
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      reviewState: opportunity.reviewState,
      publishState: opportunity.publishState,
    },
    itinerary: preview,
    totalDays,
    totalActivities,
    republishChanges: buildRepublishChanges(input.existingTripKit ?? null, preview, totalDays, totalActivities),
  }
}

function buildRepublishChanges(
  existingTripKit: ExistingTripKit | null,
  preview: {
    title: string
    slug: string
    primaryCity: string | null
  },
  totalDays: number,
  totalActivities: number,
) {
  if (!existingTripKit) return []

  const existingTotalActivities = (existingTripKit.days ?? []).reduce(
    (sum, day) => sum + (day.activities?.length ?? 0),
    0,
  )
  const changes: string[] = []

  if (existingTripKit.title !== preview.title) {
    changes.push(`Title will change from "${existingTripKit.title}" to "${preview.title}"`)
  }
  if (existingTripKit.slug !== preview.slug) {
    changes.push(`Slug will update to /${preview.slug}`)
  }
  if ((existingTripKit.primaryCity ?? null) !== preview.primaryCity) {
    changes.push(`Primary destination will change to ${preview.primaryCity ?? 'Not set'}`)
  }
  if ((existingTripKit.durationDays ?? 0) !== totalDays) {
    changes.push(`Day count will change from ${existingTripKit.durationDays ?? 0} to ${totalDays}`)
  }
  if (existingTotalActivities !== totalActivities) {
    changes.push(`Activity count will change from ${existingTotalActivities} to ${totalActivities}`)
  }

  return changes
}

function publishPriority(publishState: string) {
  switch (publishState) {
    case 'DRAFT':
      return 2
    case 'PUBLISHED':
      return 1
    default:
      return 0
  }
}
