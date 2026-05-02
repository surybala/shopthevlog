import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

const mockCreatorFindUnique = vi.fn()
const mockDayFindUnique = vi.fn()
const mockActivityFindUnique = vi.fn()
const mockActivityFindFirst = vi.fn()
const mockActivityCreate = vi.fn()
const mockActivityUpdate = vi.fn()
const mockActivityDelete = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
    itineraryDay: {
      findUnique: (...args: unknown[]) => mockDayFindUnique(...args),
    },
    dayActivity: {
      findFirst: (...args: unknown[]) => mockActivityFindFirst(...args),
      create: (...args: unknown[]) => mockActivityCreate(...args),
      update: (...args: unknown[]) => mockActivityUpdate(...args),
      delete: (...args: unknown[]) => mockActivityDelete(...args),
      findUnique: (...args: unknown[]) => mockActivityFindUnique(...args),
    },
  },
}))

import { POST as createActivity } from '../app/api/kits/[id]/days/[dayId]/activities/route'
import {
  PATCH as updateActivity,
  DELETE as deleteActivity,
} from '../app/api/kits/[id]/days/[dayId]/activities/[actId]/route'

describe('kit activity routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
    mockDayFindUnique.mockResolvedValue({
      id: 'day-1',
      tripKitId: 'kit-1',
      tripKit: { creatorId: 'creator-1' },
    })
    mockActivityFindUnique.mockResolvedValue({
      id: 'act-1',
      dayId: 'day-1',
      day: {
        tripKitId: 'kit-1',
        tripKit: { creatorId: 'creator-1' },
      },
    })
    mockActivityFindFirst.mockResolvedValue({ sortOrder: 2 })
    mockActivityCreate.mockResolvedValue({ id: 'act-3', sortOrder: 3, type: 'FOOD' })
    mockActivityUpdate.mockResolvedValue({ id: 'act-1', title: 'Updated' })
    mockActivityDelete.mockResolvedValue({})
  })

  it('creates an activity with the next sort order and normalized type', async () => {
    const res = await createActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Dinner',
          type: 'FOOD',
        }),
      }),
      { params: { id: 'kit-1', dayId: 'day-1' } }
    )

    expect(res.status).toBe(201)
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dayId: 'day-1',
          sortOrder: 3,
          title: 'Dinner',
          type: 'FOOD',
        }),
      })
    )
  })

  it('falls back to OTHER for unknown activity types', async () => {
    await createActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Mystery Stop',
          type: 'NOT_REAL',
        }),
      }),
      { params: { id: 'kit-1', dayId: 'day-1' } }
    )

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'OTHER' }),
      })
    )
  })

  it('returns 404 when the viewer does not own the day during create', async () => {
    mockDayFindUnique.mockResolvedValue(null)

    const res = await createActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: { id: 'kit-1', dayId: 'day-1' } }
    )

    expect(res.status).toBe(404)
  })

  it('patches only supplied activity fields and allows detaching affiliate links', async () => {
    const res = await updateActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities/act-1', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated',
          type: 'WELLNESS',
          affiliateLinkId: null,
        }),
      }),
      { params: { id: 'kit-1', dayId: 'day-1', actId: 'act-1' } }
    )

    expect(res.status).toBe(200)
    expect(mockActivityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act-1' },
        data: expect.objectContaining({
          title: 'Updated',
          type: 'WELLNESS',
          affiliateLinkId: null,
        }),
      })
    )
  })

  it('returns 404 when the viewer does not own the activity during update or delete', async () => {
    mockActivityFindUnique.mockResolvedValue(null)

    let res = await updateActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities/act-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
      }),
      { params: { id: 'kit-1', dayId: 'day-1', actId: 'act-1' } }
    )
    expect(res.status).toBe(404)

    res = await deleteActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities/act-1', {
        method: 'DELETE',
      }),
      { params: { id: 'kit-1', dayId: 'day-1', actId: 'act-1' } }
    )
    expect(res.status).toBe(404)
  })

  it('deletes an owned activity', async () => {
    const res = await deleteActivity(
      new NextRequest('http://localhost/api/kits/kit-1/days/day-1/activities/act-1', {
        method: 'DELETE',
      }),
      { params: { id: 'kit-1', dayId: 'day-1', actId: 'act-1' } }
    )

    expect(res.status).toBe(200)
    expect(mockActivityDelete).toHaveBeenCalledWith({ where: { id: 'act-1' } })
  })
})
