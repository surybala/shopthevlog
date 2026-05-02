import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockIsAdminUser = vi.fn()
const mockFindMany = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
}))

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
    },
  },
}))

vi.mock('../app/dashboard/payout-ops/PayoutOpsTable', () => ({
  default: ({ title, rows }: { title: string; rows: unknown[] }) =>
    React.createElement('div', { 'data-title': title, 'data-count': rows.length }, 'PayoutOpsTable'),
}))

import PayoutOpsPage from '../app/dashboard/payout-ops/page'

describe('PayoutOpsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'ops@example.com' } } })
    mockIsAdminUser.mockReturnValue(true)
    mockFindMany.mockResolvedValue([
      {
        id: 'comm-pending',
        status: 'PENDING',
        creatorEarnings: 1400,
        provider: 'GETYOURGUIDE',
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
        convertedAt: new Date('2026-04-09T00:00:00.000Z'),
        paidAt: null,
        creator: { displayName: 'Alex Wanders', handle: 'alexwanders' },
        affiliateLink: { targetName: 'Park Hyatt Tokyo' },
        attributedTripKit: { title: 'Tokyo Stay Guide' },
      },
      {
        id: 'comm-confirmed',
        status: 'CONFIRMED',
        creatorEarnings: 3600,
        provider: 'VIATOR',
        createdAt: new Date('2026-04-11T00:00:00.000Z'),
        convertedAt: new Date('2026-04-10T00:00:00.000Z'),
        paidAt: null,
        creator: { displayName: 'Alex Wanders', handle: 'alexwanders' },
        affiliateLink: { targetName: 'Tokyo Food Tour' },
        attributedTripKit: null,
      },
      {
        id: 'comm-paid',
        status: 'PAID',
        creatorEarnings: 2100,
        provider: 'STAY22',
        createdAt: new Date('2026-04-12T00:00:00.000Z'),
        convertedAt: new Date('2026-04-11T00:00:00.000Z'),
        paidAt: new Date('2026-04-15T00:00:00.000Z'),
        creator: { displayName: 'Casey Coast', handle: 'caseycoast' },
        affiliateLink: { targetName: 'Beach Resort' },
        attributedTripKit: { title: 'Island Escape' },
      },
    ])
  })

  it('renders the admin payout ops dashboard with grouped sections', async () => {
    const page = await PayoutOpsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Admin payout ops')
    expect(html).toContain('Review pending commissions, clear payout-ready balances, and keep creator earnings moving.')
    expect(html).toContain('Pending review')
    expect(html).toContain('Ready to pay')
    expect(html).toContain('Already paid')
    expect(html).toContain('PayoutOpsTable')
    expect(html).toContain('Top creator exposure')
  })
})
