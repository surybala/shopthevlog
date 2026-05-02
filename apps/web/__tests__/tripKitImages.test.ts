import { describe, expect, it } from 'vitest'

import { getTripKitCardImageUrl } from '../lib/tripKitImages'

describe('getTripKitCardImageUrl', () => {
  it('prefers the explicit cover image', () => {
    expect(
      getTripKitCardImageUrl({
        coverImageUrl: 'creators/creator-1/kits/cover.jpg',
        sourceVlogs: [{ vlog: { thumbnailUrl: 'https://img.youtube.com/vi/example/hqdefault.jpg' } }],
      }),
    ).toBe('/api/media?path=creators%2Fcreator-1%2Fkits%2Fcover.jpg')
  })

  it('falls back to the first source vlog thumbnail', () => {
    expect(
      getTripKitCardImageUrl({
        coverImageUrl: null,
        sourceVlogs: [{ vlog: { thumbnailUrl: 'https://img.youtube.com/vi/example/hqdefault.jpg' } }],
      }),
    ).toBe('https://img.youtube.com/vi/example/hqdefault.jpg')
  })

  it('returns null when no image is available', () => {
    expect(getTripKitCardImageUrl({ coverImageUrl: null, sourceVlogs: [] })).toBeNull()
  })
})
