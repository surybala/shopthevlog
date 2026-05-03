import { describe, expect, it } from 'vitest'
import {
  buildStorageAssetUrl,
  isStorageAssetPath,
  resolveStorageAssetUrl,
} from '../lib/storageAssets'

describe('storage asset helpers', () => {
  it('detects creator storage paths', () => {
    expect(isStorageAssetPath('creators/creator-1/creator portal/cover/cover.jpg')).toBe(true)
    expect(isStorageAssetPath('https://example.com/image.jpg')).toBe(false)
  })

  it('builds proxy urls for storage paths', () => {
    expect(buildStorageAssetUrl('creators/creator-1/creator portal/cover/cover.jpg')).toBe(
      '/api/media?path=creators%2Fcreator-1%2Fstorefront%2Fcover%2Fcover.jpg',
    )
  })

  it('passes through external urls and rewrites storage paths', () => {
    expect(resolveStorageAssetUrl('https://example.com/image.jpg')).toBe('https://example.com/image.jpg')
    expect(resolveStorageAssetUrl('creators/creator-1/creator portal/cover/cover.jpg')).toBe(
      '/api/media?path=creators%2Fcreator-1%2Fstorefront%2Fcover%2Fcover.jpg',
    )
  })
})
