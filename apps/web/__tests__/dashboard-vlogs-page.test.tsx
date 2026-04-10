import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()
const mockVlogFindMany = vi.fn()
const mockPlanConfig = vi.fn()

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
    vlog: {
      findMany: (...args: unknown[]) => mockVlogFindMany(...args),
    },
  },
}))

vi.mock('@/lib/creatorPlans', () => ({
  getCreatorPlanConfig: (...args: unknown[]) => mockPlanConfig(...args),
}))

vi.mock('../app/dashboard/vlogs/VlogsClient', () => ({
  default: ({ initialVlogs }: { initialVlogs: unknown[] }) =>
    React.createElement('div', { 'data-count': initialVlogs.length }, 'VlogsClient'),
}))

import VlogsPage from '../app/dashboard/vlogs/page'

describe('VlogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', plan: 'FREE' })
    mockPlanConfig.mockReturnValue({ maxImportedVlogs: 5 })
    mockVlogFindMany.mockResolvedValue([
      {
        id: 'vlog-1',
        title: 'Tokyo Capsule Hotel Tour',
        publishedAt: new Date('2026-04-08T00:00:00.000Z'),
        tripKits: [],
      },
    ])
  })

  it('renders the upgraded vlogs dashboard shell', async () => {
    const page = await VlogsPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Video library')
    expect(html).toContain('Source videos powering your storefront.')
    expect(html).toContain('1/5 videos imported')
    expect(html).toContain('dashboard-mirror-panel')
    expect(html).toContain('VlogsClient')
  })
})
