import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()

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

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
  },
}))

vi.mock('../app/dashboard/settings/SettingsForm', () => ({
  default: () => React.createElement('div', null, 'SettingsForm'),
}))

import DashboardSettingsPage from '../app/dashboard/settings/page'

describe('DashboardSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'creator@example.com' } } })
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      tiers: [],
    })
  })

  it('renders the refreshed settings hero', async () => {
    const page = await DashboardSettingsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Creator identity')
    expect(html).toContain('Settings')
    expect(html).toContain('Manage your profile, channels, creator portal theme, and subscription tiers.')
    expect(html).toContain('SettingsForm')
  })
})
