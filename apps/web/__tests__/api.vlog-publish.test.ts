import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockVlogFindFirst = vi.fn()
const mockTransaction = vi.fn()
const mockItineraryDayFindMany = vi.fn()
const mockAffiliateFindUnique = vi.fn()
const mockAffiliateFindFirst = vi.fn()
const mockAffiliateCreate = vi.fn()
const mockAffiliateUpdate = vi.fn()
const mockDayActivityUpdate = vi.fn()
const mockCreateStay22Link = vi.fn()
const mockBuildStay22FallbackUrl = vi.fn()
const mockFindGYGActivity = vi.fn()
const mockBuildGYGFallbackUrl = vi.fn()
const mockFindViatorProduct = vi.fn()

const txTripKitUpdate = vi.fn()
const txDayActivityDeleteMany = vi.fn()
const txItineraryDayDeleteMany = vi.fn()
const txTripKitCreate = vi.fn()
const txTripKitsOnVlogsCreate = vi.fn()
const txItineraryDayCreate = vi.fn()
const txOpportunityUpdate = vi.fn()
const txOpportunityUpdateMany = vi.fn()
const txVlogUpdate = vi.fn()
const txTripKitFindUnique = vi.fn()
const mockRecordApiObservation = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    vlog: { findFirst: (...args: unknown[]) => mockVlogFindFirst(...args) },
    itineraryDay: { findMany: (...args: unknown[]) => mockItineraryDayFindMany(...args) },
    affiliateLink: {
      findUnique: (...args: unknown[]) => mockAffiliateFindUnique(...args),
      findFirst: (...args: unknown[]) => mockAffiliateFindFirst(...args),
      create: (...args: unknown[]) => mockAffiliateCreate(...args),
      update: (...args: unknown[]) => mockAffiliateUpdate(...args),
    },
    dayActivity: {
      update: (...args: unknown[]) => mockDayActivityUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

vi.mock('@/lib/affiliates/stay22', () => ({
  createStay22Link: (...args: unknown[]) => mockCreateStay22Link(...args),
  buildStay22FallbackUrl: (...args: unknown[]) => mockBuildStay22FallbackUrl(...args),
}))

vi.mock('@/lib/affiliates/gyg', () => ({
  findGYGActivity: (...args: unknown[]) => mockFindGYGActivity(...args),
  buildGYGFallbackUrl: (...args: unknown[]) => mockBuildGYGFallbackUrl(...args),
}))

vi.mock('@/lib/affiliates/viator', () => ({
  findViatorProduct: (...args: unknown[]) => mockFindViatorProduct(...args),
}))

import { POST as publishVlog } from '../app/api/vlogs/[id]/publish/route'

describe('vlog publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })

    txTripKitUpdate.mockResolvedValue({})
    txDayActivityDeleteMany.mockResolvedValue({})
    txItineraryDayDeleteMany.mockResolvedValue({})
    txTripKitCreate.mockResolvedValue({ id: 'kit-1', title: '5 Days in Tokyo', slug: '5-days-in-tokyo-abc123' })
    txTripKitsOnVlogsCreate.mockResolvedValue({})
    txItineraryDayCreate.mockResolvedValue({})
    txOpportunityUpdate.mockResolvedValue({})
    txOpportunityUpdateMany.mockResolvedValue({ count: 0 })
    txVlogUpdate.mockResolvedValue({})
    txTripKitFindUnique.mockResolvedValue({ id: 'kit-1', title: '5 Days in Tokyo', slug: '5-days-in-tokyo-abc123', isPublished: true })
    mockItineraryDayFindMany.mockResolvedValue([])
    mockAffiliateFindUnique.mockResolvedValue(null)
    mockAffiliateFindFirst.mockResolvedValue(null)
    mockAffiliateCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'aff-1', ...data }))
    mockAffiliateUpdate.mockResolvedValue({})
    mockDayActivityUpdate.mockResolvedValue({})
    mockCreateStay22Link.mockResolvedValue(null)
    mockBuildStay22FallbackUrl.mockReturnValue('https://stay22.example/search')
    mockFindGYGActivity.mockResolvedValue(null)
    mockBuildGYGFallbackUrl.mockReturnValue('https://gyg.example/search')
    mockFindViatorProduct.mockResolvedValue(null)

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      tripKit: {
        update: txTripKitUpdate,
        create: txTripKitCreate,
        findUnique: txTripKitFindUnique,
      },
      dayActivity: {
        deleteMany: txDayActivityDeleteMany,
      },
      itineraryDay: {
        deleteMany: txItineraryDayDeleteMany,
        create: txItineraryDayCreate,
      },
      tripKitsOnVlogs: {
        create: txTripKitsOnVlogsCreate,
      },
      opportunity: {
        update: txOpportunityUpdate,
        updateMany: txOpportunityUpdateMany,
      },
      vlog: {
        update: txVlogUpdate,
      },
    }))

    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await publishVlog(new Request('http://localhost/api/vlogs/vlog-1/publish', { method: 'POST' }), {
      params: { id: 'vlog-1' },
    })

    expect(res.status).toBe(401)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/vlogs/[id]/publish', 401, expect.any(Number), 'unauthorized')
  })

  it('creates a published Trip Kit from an approved itinerary opportunity', async () => {
    mockVlogFindFirst.mockResolvedValue({
      id: 'vlog-1',
      creatorId: 'creator-1',
      opportunities: [
        {
          id: 'opp-1',
          title: 'Tokyo itinerary',
          description: 'A fantastic trip through Tokyo.',
          reviewState: 'APPROVED',
          publishState: 'DRAFT',
          metadataJson: {
            itinerary: {
              title: '5 Days in Tokyo',
              summary: 'A fantastic trip through Tokyo.',
              total_days: 2,
              destinations: ['Tokyo'],
              countries: ['Japan'],
              primary_city: 'Tokyo',
              estimated_budget_usd: 2000,
              days: [
                {
                  day_number: 1,
                  title: 'Arrival',
                  city: 'Tokyo',
                  country: 'Japan',
                  tips: ['Get a Suica card'],
                  activities: [{ type: 'ACCOMMODATION', title: 'Park Hyatt Tokyo' }],
                },
              ],
            },
          },
          createdAt: new Date('2026-04-09T00:00:00.000Z'),
          updatedAt: new Date('2026-04-09T00:00:00.000Z'),
        },
      ],
      tripKits: [],
    })
    mockItineraryDayFindMany.mockResolvedValue([
      {
        id: 'day-1',
        dayNumber: 1,
        city: 'Tokyo',
        country: 'Japan',
        activities: [
          {
            id: 'act-1',
            affiliateLinkId: null,
            type: 'ACCOMMODATION',
            title: 'Park Hyatt Tokyo',
            description: null,
            latitude: null,
            longitude: null,
          },
        ],
      },
    ])

    const res = await publishVlog(new Request('http://localhost/api/vlogs/vlog-1/publish', { method: 'POST' }), {
      params: { id: 'vlog-1' },
    })

    expect(res.status).toBe(200)
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/vlogs/[id]/publish', 200, expect.any(Number), 'published')
    expect(txTripKitCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creatorId: 'creator-1',
        title: '5 Days in Tokyo',
        isPublished: true,
        generatedByAI: true,
      }),
      select: { id: true, title: true, slug: true },
    })
    expect(txTripKitsOnVlogsCreate).toHaveBeenCalledWith({
      data: { tripKitId: 'kit-1', vlogId: 'vlog-1' },
    })
    expect(txItineraryDayCreate).toHaveBeenCalled()
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorId: 'creator-1',
          targetName: 'Park Hyatt Tokyo',
          provider: 'STAY22',
          type: 'HOTEL',
        }),
      }),
    )
    expect(txOpportunityUpdate).toHaveBeenCalledWith({
      where: { id: 'opp-1' },
      data: { publishState: 'PUBLISHED' },
    })
    expect(txOpportunityUpdateMany).not.toHaveBeenCalled()
  })

  it('republishes into an existing Trip Kit when one is already linked', async () => {
    mockVlogFindFirst.mockResolvedValue({
      id: 'vlog-1',
      creatorId: 'creator-1',
      opportunities: [
        {
          id: 'opp-1',
          title: 'Tokyo itinerary',
          description: 'A fantastic trip through Tokyo.',
          reviewState: 'EDITED',
          publishState: 'DRAFT',
          metadataJson: {
            itinerary: {
              title: '5 Days in Tokyo',
              total_days: 1,
              destinations: ['Tokyo'],
              countries: ['Japan'],
              days: [],
            },
          },
          createdAt: new Date('2026-04-09T00:00:00.000Z'),
          updatedAt: new Date('2026-04-10T00:00:00.000Z'),
        },
        {
          id: 'opp-older',
          title: 'Old Tokyo itinerary',
          description: 'Older version.',
          reviewState: 'APPROVED',
          publishState: 'PUBLISHED',
          metadataJson: {
            itinerary: {
              title: 'Old Tokyo itinerary',
              total_days: 1,
              destinations: ['Tokyo'],
              countries: ['Japan'],
              days: [],
            },
          },
          createdAt: new Date('2026-04-08T00:00:00.000Z'),
          updatedAt: new Date('2026-04-08T00:00:00.000Z'),
        },
      ],
      tripKits: [
        {
          tripKit: {
            id: 'kit-existing',
            title: 'Tokyo Draft',
            slug: 'tokyo-draft-abc123',
            isPublished: false,
          },
        },
      ],
    })
    txTripKitFindUnique.mockResolvedValue({
      id: 'kit-existing',
      title: '5 Days in Tokyo',
      slug: '5-days-in-tokyo-abc123',
      isPublished: true,
    })

    const res = await publishVlog(new Request('http://localhost/api/vlogs/vlog-1/publish', { method: 'POST' }), {
      params: { id: 'vlog-1' },
    })

    expect(res.status).toBe(200)
    expect(txTripKitUpdate).toHaveBeenCalled()
    expect(txDayActivityDeleteMany).toHaveBeenCalledWith({
      where: {
        day: {
          tripKitId: 'kit-existing',
        },
      },
    })
    expect(txItineraryDayDeleteMany).toHaveBeenCalledWith({
      where: {
        tripKitId: 'kit-existing',
      },
    })
    expect(txOpportunityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['opp-older'] },
      },
      data: {
        publishState: 'SUPPRESSED',
      },
    })
  })

  it('returns 409 when no approved itinerary is ready to publish', async () => {
    mockVlogFindFirst.mockResolvedValue({
      id: 'vlog-1',
      creatorId: 'creator-1',
      opportunities: [],
      tripKits: [],
    })

    const res = await publishVlog(new Request('http://localhost/api/vlogs/vlog-1/publish', { method: 'POST' }), {
      params: { id: 'vlog-1' },
    })

    expect(res.status).toBe(409)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('auto-resolves experience and flight-style transport activities after publish', async () => {
    mockVlogFindFirst.mockResolvedValue({
      id: 'vlog-1',
      creatorId: 'creator-1',
      opportunities: [
        {
          id: 'opp-1',
          title: 'Bangkok itinerary',
          description: 'A fast weekend route.',
          reviewState: 'APPROVED',
          publishState: 'DRAFT',
          metadataJson: {
            itinerary: {
              title: 'Bangkok Weekend',
              total_days: 1,
              destinations: ['Bangkok'],
              countries: ['Thailand'],
              primary_city: 'Bangkok',
              days: [
                {
                  day_number: 1,
                  title: 'Arrival',
                  city: 'Bangkok',
                  country: 'Thailand',
                  activities: [
                    { type: 'TOUR', title: 'Floating Market Tour' },
                    { type: 'TRANSPORT', title: 'Flight to Bangkok' },
                    { type: 'FOOD', title: 'Pad Thai dinner' },
                  ],
                },
              ],
            },
          },
          createdAt: new Date('2026-04-09T00:00:00.000Z'),
          updatedAt: new Date('2026-04-09T00:00:00.000Z'),
        },
      ],
      tripKits: [],
    })
    mockItineraryDayFindMany.mockResolvedValue([
      {
        id: 'day-1',
        dayNumber: 1,
        city: 'Bangkok',
        country: 'Thailand',
        activities: [
          {
            id: 'act-tour',
            affiliateLinkId: null,
            type: 'TOUR',
            title: 'Floating Market Tour',
            description: null,
            latitude: null,
            longitude: null,
          },
          {
            id: 'act-flight',
            affiliateLinkId: null,
            type: 'TRANSPORT',
            title: 'Flight to Bangkok',
            description: null,
            latitude: null,
            longitude: null,
          },
          {
            id: 'act-food',
            affiliateLinkId: null,
            type: 'FOOD',
            title: 'Pad Thai dinner',
            description: null,
            latitude: null,
            longitude: null,
          },
        ],
      },
    ])

    const res = await publishVlog(new Request('http://localhost/api/vlogs/vlog-1/publish', { method: 'POST' }), {
      params: { id: 'vlog-1' },
    })

    expect(res.status).toBe(200)
    expect(mockItineraryDayFindMany).toHaveBeenCalled()
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetName: 'Floating Market Tour',
          provider: 'GETYOURGUIDE',
          type: 'EXPERIENCE_TOUR',
        }),
      }),
    )
    expect(mockAffiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetName: 'Flight to Bangkok',
          provider: 'SKYSCANNER',
          type: 'FLIGHT_SEARCH',
        }),
      }),
    )
    expect(mockAffiliateCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetName: 'Pad Thai dinner',
        }),
      }),
    )
  })
})
