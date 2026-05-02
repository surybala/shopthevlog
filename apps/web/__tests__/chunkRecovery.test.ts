import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearChunkRecovery, isChunkLoadIssue, shouldRecoverChunk } from '../lib/chunkRecovery'

describe('chunkRecovery', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    const store = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })

  it('detects stale chunk errors from common browser messages', () => {
    expect(isChunkLoadIssue(new Error('Loading chunk app/dashboard/kits/page failed.'))).toBe(true)
    expect(isChunkLoadIssue({ message: 'ChunkLoadError: Loading chunk 123 failed' })).toBe(true)
    expect(isChunkLoadIssue('Failed to fetch dynamically imported module')).toBe(true)
    expect(isChunkLoadIssue('Database connection failed')).toBe(false)
  })

  it('only allows one recovery attempt inside the retry window', () => {
    expect(shouldRecoverChunk('/dashboard/kits', 1000)).toBe(true)
    expect(shouldRecoverChunk('/dashboard/kits', 2000)).toBe(false)

    clearChunkRecovery('/dashboard/kits')
    expect(shouldRecoverChunk('/dashboard/kits', 3000)).toBe(true)
  })
})
