import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
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

import NewAffiliateLinkPage from '../app/dashboard/affiliates/new/page'

describe('NewAffiliateLinkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1' })
  })

  it('renders the affiliate link composer instead of 404ing', async () => {
    const page = await NewAffiliateLinkPage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Add a monetized link to your creator portal.')
    expect(html).toContain('Paste a partner URL you already have')
    expect(html).toContain('Save affiliate link')
    expect(html).toContain('Resolve affiliate link')
    expect(html).toContain('href="/dashboard/affiliates"')
  })
})
