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

  it('renders updated creator and subscriber positioning for signed-out users', async () => {
    const page = await HomePage()
    const html = renderToStaticMarkup(page)

    expect(html).toContain('Curated by creators for their subscribers')
    expect(html).toContain('reviewable storefronts subscribers actually shop')
    expect(html).toContain('evidence-backed opportunity graph')
    expect(html).toContain('href="#subscribers"')
    expect(html).toContain("Subscribers don&#x27;t just watch the trip. They can unlock it.")
    expect(html).toContain('Join the creator waitlist')
    expect(html).toContain('Browse creator storefronts')
    expect(html).toContain('landing-ticker')
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
