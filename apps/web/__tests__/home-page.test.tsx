import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.fn((href: string) => {
  throw new Error(`REDIRECT:${href}`)
})

const mockGetUser = vi.fn()
const mockCreatorFindUnique = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', src = '', ...props }: { alt?: string; src?: string }) =>
    React.createElement('img', { alt, src, ...props }),
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

import HomePage from '../app/page'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockCreatorFindUnique.mockResolvedValue(null)
  })

  it('renders creator portal narrative for signed-out users', async () => {
    const page = await HomePage()
    const html = renderToStaticMarkup(page)

    // Hero
    expect(html).toContain('Creator portals for travel vloggers')
    expect(html).toContain('Your niche. Your audience.')
    expect(html).toContain('Your playbook.')
    expect(html).toContain('own their corner of the internet')
    expect(html).toContain('Get your creator portal')
    expect(html).toContain('Explore creator portals')

    // Creator portal panel
    expect(html).toContain('Insights first. Monetization when you&#x27;re ready.')
    expect(html).toContain('landing-pipeline-panel')
    expect(html).toContain('landing-ticker')

    // For creators section
    expect(html).toContain('Grow first. Monetize the trips you already filmed.')
    expect(html).toContain('href="#subscribers"')
    expect(html).toContain('Trip Kit preview')

    // For subscribers section
    expect(html).toContain("Subscribers don&#x27;t just watch the trip. They can unlock it.")

    // Pipeline section
    expect(html).toContain('A creator portal built for real growth, not vanity metrics.')

    // CTA + footer
    expect(html).toContain('Browse creator portals')
    expect(html).toContain('Copyright 2026 VlogShopper. All rights reserved.')
    expect(html).not.toContain('Review ready')
  })

  it('redirects signed-in creators to the dashboard', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'creator@example.com',
        },
      },
    })
    mockCreatorFindUnique.mockResolvedValue({ handle: 'alexwanders' })

    await expect(HomePage()).rejects.toThrow('REDIRECT:/dashboard')
    expect(mockCreatorFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { handle: true },
    })
  })
})
