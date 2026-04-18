import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockIsAdminUser = vi.fn()
const mockFindMany = vi.fn()
const mockUpdateMany = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('@/lib/admin', () => ({
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    commission: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}))

import { GET, POST } from '../app/api/admin/payout-ops/route'

describe('admin payout ops route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'ops@example.com' } } })
    mockIsAdminUser.mockReturnValue(true)
    mockFindMany.mockResolvedValue([{ id: 'comm-1' }])
    mockUpdateMany.mockResolvedValue({ count: 2 })
  })

  it('rejects unauthenticated requests', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(new NextRequest('http://localhost/api/admin/payout-ops'))

    expect(response.status).toBe(401)
  })

  it('rejects non-admin requests', async () => {
    mockIsAdminUser.mockReturnValue(false)

    const response = await GET(new NextRequest('http://localhost/api/admin/payout-ops'))

    expect(response.status).toBe(403)
  })

  it('returns filtered commission rows for admins', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/payout-ops?status=PENDING'))

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        take: 200,
      }),
    )
  })

  it('confirms pending commissions in bulk', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/payout-ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'confirm',
          commissionIds: ['comm-1', 'comm-2'],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['comm-1', 'comm-2'] },
        status: { in: ['PENDING'] },
      },
      data: {
        status: 'CONFIRMED',
        paidAt: null,
      },
    })
  })

  it('marks confirmed commissions as paid in bulk', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/payout-ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'mark_paid',
          commissionIds: ['comm-1'],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['comm-1'] },
          status: { in: ['CONFIRMED'] },
        },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
        }),
      }),
    )
  })

  it('returns 400 for invalid actions', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/payout-ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'ship_it',
          commissionIds: ['comm-1'],
        }),
      }),
    )

    expect(response.status).toBe(400)
  })

  it('returns 409 when no rows can be updated', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const response = await POST(
      new NextRequest('http://localhost/api/admin/payout-ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reverse',
          commissionIds: ['comm-1'],
        }),
      }),
    )

    expect(response.status).toBe(409)
  })
})
