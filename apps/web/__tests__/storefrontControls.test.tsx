import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import FollowButton from '../components/FollowButton'
import SaveKitButton from '../components/SaveKitButton'

describe('creator portal controls', () => {
  it('renders themed follow states without legacy white-on-dark classes', () => {
    const followHtml = renderToStaticMarkup(
      <FollowButton creatorHandle="alexwanders" initialFollowing={false} isLoggedIn />,
    )
    const followingHtml = renderToStaticMarkup(
      <FollowButton creatorHandle="alexwanders" initialFollowing isLoggedIn />,
    )

    expect(followHtml).toContain('btn-primary')
    expect(followHtml).not.toContain('text-white/60')
    expect(followingHtml).toContain('creator portal-outline-button--active')
    expect(followingHtml).not.toContain('border-white/20')
  })

  it('renders themed save states without legacy white-on-dark classes', () => {
    const unsavedHtml = renderToStaticMarkup(
      <SaveKitButton kitId="kit-1" initialSaved={false} isLoggedIn creatorHandle="alexwanders" />,
    )
    const savedHtml = renderToStaticMarkup(
      <SaveKitButton kitId="kit-1" initialSaved isLoggedIn creatorHandle="alexwanders" />,
    )

    expect(unsavedHtml).toContain('creator portal-outline-button')
    expect(unsavedHtml).not.toContain('text-white')
    expect(savedHtml).toContain('creator portal-outline-button--active')
    expect(savedHtml).toContain('Saved')
  })
})
