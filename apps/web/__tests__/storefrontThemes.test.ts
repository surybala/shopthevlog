import { describe, expect, it } from 'vitest'
import { getStorefrontTheme, parseStorefrontGalleryImages, STOREFRONT_THEMES } from '../lib/storefrontThemes'

describe('storefront themes', () => {
  it('exposes a dozen creator-selectable templates', () => {
    expect(STOREFRONT_THEMES).toHaveLength(12)
    expect(STOREFRONT_THEMES.map((theme) => theme.id)).toContain('CITY_EDITORIAL')
    expect(STOREFRONT_THEMES.map((theme) => theme.id)).toContain('BEACH_RETREAT')
  })

  it('falls back to city editorial when the theme id is unknown', () => {
    expect(getStorefrontTheme('UNKNOWN').id).toBe('CITY_EDITORIAL')
  })

  it('provides image-backed previews and storefront backdrops for every theme', () => {
    for (const theme of STOREFRONT_THEMES) {
      expect(theme.previewImageUrl.startsWith('data:image/svg+xml')).toBe(true)
      expect(theme.storefrontBackdropImageUrl.startsWith('data:image/svg+xml')).toBe(true)
    }
  })

  it('parses custom gallery URLs from newline-separated input', () => {
    expect(
      parseStorefrontGalleryImages('https://example.com/one.jpg\n\n https://example.com/two.jpg ')
    ).toEqual(['https://example.com/one.jpg', 'https://example.com/two.jpg'])
  })
})
