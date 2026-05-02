import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

import KitEditor from '../app/dashboard/kits/KitEditor'

describe('KitEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the upgraded mirrored editor shell', () => {
    const html = renderToStaticMarkup(<KitEditor creatorId="creator-1" creatorHandle="alex" kit={null} />)

    expect(html).toContain('Shape the Trip Kit before it goes live.')
    expect(html).toContain('Choose how this guide unlocks.')
    expect(html).toContain('Save the Trip Kit first.')
    expect(html).toContain('Create Trip Kit')
    expect(html).toContain('dashboard-mirror-card')
    expect(html).toContain('dashboard-input')
  })
})
