import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: () => null,
  }),
}))

import WaitlistPage from '../app/waitlist/page'

describe('WaitlistPage', () => {
  it('renders the polished beta request hierarchy', () => {
    const html = renderToStaticMarkup(<WaitlistPage />)

    expect(html).toContain('VlogShopper')
    expect(html).toContain('Private beta access')
    expect(html).toContain('Early access only')
    expect(html).toContain('Request early access')
    expect(html).toContain('Copyright 2026 VlogShopper. All rights reserved.')
    expect(html).not.toContain('>Pass<')
  })
})
