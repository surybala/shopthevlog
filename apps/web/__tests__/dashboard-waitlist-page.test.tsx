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
    waitlistRequest: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}))

vi.mock('../app/dashboard/waitlist/WaitlistTable', () => ({
  default: ({ requests }: { requests: unknown[] }) =>
    React.createElement('div', { 'data-count': requests.length }, 'WaitlistTable'),
}))

import WaitlistAdminPage from '../app/dashboard/waitlist/page'

describe('WaitlistAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } } })
    mockIsAdminUser.mockReturnValue(true)
    mockFindMany
      .mockResolvedValueOnce([{ id: 'req-1', status: 'PENDING' }])
      .mockResolvedValueOnce([{ id: 'req-2', status: 'APPROVED' }])
      .mockResolvedValueOnce([{ id: 'req-3', status: 'REJECTED' }])
  })

  it('renders the refreshed waitlist admin shell', async () => {
    const page = await WaitlistAdminPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Manage your private beta queue.')
    expect(html).toContain('1 pending · 1 approved · 1 rejected')
    expect(html).toContain('dashboard-mirror-panel')
    expect(html).toContain('WaitlistTable')
  })
})
