import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockOpportunityFindUnique = vi.fn()
const mockOpportunityUpdate = vi.fn()
const mockFeedbackCreate = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    opportunity: {
      findUnique: (...args: unknown[]) => mockOpportunityFindUnique(...args),
      update: (...args: unknown[]) => mockOpportunityUpdate(...args),
    },
    opportunityFeedback: {
      create: (...args: unknown[]) => mockFeedbackCreate(...args),
    },
  },
}))

import { POST as approveOpportunity } from '../app/api/opportunities/[id]/approve/route'
import { POST as rejectOpportunity } from '../app/api/opportunities/[id]/reject/route'
import { PATCH as editOpportunity } from '../app/api/opportunities/[id]/route'

describe('opportunity review routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockOpportunityFindUnique.mockResolvedValue({ id: 'opp-1', creatorId: 'creator-1' })
    mockOpportunityUpdate.mockResolvedValue({ id: 'opp-1', reviewState: 'APPROVED', publishState: 'DRAFT' })
    mockFeedbackCreate.mockResolvedValue({ id: 'feedback-1' })
  })

  it('approve returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await approveOpportunity(new Request('http://localhost/api/opportunities/opp-1/approve', { method: 'POST' }), { params: { id: 'opp-1' } })
    expect(res.status).toBe(401)
  })

  it('approve returns 404 when the opportunity is not owned', async () => {
    mockOpportunityFindUnique.mockResolvedValue({ id: 'opp-1', creatorId: 'creator-2' })
    const res = await approveOpportunity(new Request('http://localhost/api/opportunities/opp-1/approve', { method: 'POST' }), { params: { id: 'opp-1' } })
    expect(res.status).toBe(404)
  })

  it('approve updates the review state and records feedback', async () => {
    const res = await approveOpportunity(new Request('http://localhost/api/opportunities/opp-1/approve', { method: 'POST' }), { params: { id: 'opp-1' } })

    expect(mockOpportunityUpdate).toHaveBeenCalledWith({
      where: { id: 'opp-1' },
      data: { reviewState: 'APPROVED', publishState: 'DRAFT' },
      select: { id: true, reviewState: true, publishState: true },
    })
    expect(mockFeedbackCreate).toHaveBeenCalledWith({
      data: {
        creatorId: 'creator-1',
        opportunityId: 'opp-1',
        action: 'APPROVED',
        editedFieldsJson: null,
        reason: null,
      },
    })
    expect(res.status).toBe(200)
  })

  it('reject suppresses publishing and records the rejection reason', async () => {
    mockOpportunityUpdate.mockResolvedValue({ id: 'opp-1', reviewState: 'REJECTED', publishState: 'SUPPRESSED' })

    const res = await rejectOpportunity(
      new NextRequest('http://localhost/api/opportunities/opp-1/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Not actually featured in the video' }),
      }),
      { params: { id: 'opp-1' } }
    )

    expect(mockOpportunityUpdate).toHaveBeenCalledWith({
      where: { id: 'opp-1' },
      data: { reviewState: 'REJECTED', publishState: 'SUPPRESSED' },
      select: { id: true, reviewState: true, publishState: true },
    })
    expect(mockFeedbackCreate).toHaveBeenCalledWith({
      data: {
        creatorId: 'creator-1',
        opportunityId: 'opp-1',
        action: 'REJECTED',
        editedFieldsJson: null,
        reason: 'Not actually featured in the video',
      },
    })
    expect(res.status).toBe(200)
  })

  it('edit validates title and records edited fields', async () => {
    mockOpportunityUpdate.mockResolvedValue({
      id: 'opp-1',
      title: 'Updated Tokyo Hotel',
      description: 'Closer to the station and clearly mentioned in the vlog.',
      reviewState: 'EDITED',
      publishState: 'DRAFT',
    })

    let res = await editOpportunity(
      new NextRequest('http://localhost/api/opportunities/opp-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: '   ', description: 'ignored' }),
      }),
      { params: { id: 'opp-1' } }
    )
    expect(res.status).toBe(422)

    res = await editOpportunity(
      new NextRequest('http://localhost/api/opportunities/opp-1', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated Tokyo Hotel',
          description: 'Closer to the station and clearly mentioned in the vlog.',
        }),
      }),
      { params: { id: 'opp-1' } }
    )

    expect(mockOpportunityUpdate).toHaveBeenCalledWith({
      where: { id: 'opp-1' },
      data: {
        title: 'Updated Tokyo Hotel',
        description: 'Closer to the station and clearly mentioned in the vlog.',
        reviewState: 'EDITED',
        publishState: 'DRAFT',
      },
      select: {
        id: true,
        title: true,
        description: true,
        reviewState: true,
        publishState: true,
      },
    })
    expect(mockFeedbackCreate).toHaveBeenCalledWith({
      data: {
        creatorId: 'creator-1',
        opportunityId: 'opp-1',
        action: 'EDITED',
        editedFieldsJson: {
          title: 'Updated Tokyo Hotel',
          description: 'Closer to the station and clearly mentioned in the vlog.',
        },
        reason: null,
      },
    })
    expect(res.status).toBe(200)
  })
})
