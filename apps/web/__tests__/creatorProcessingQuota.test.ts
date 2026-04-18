import { describe, expect, it } from 'vitest'

import { getCreatorProcessingQuotaSnapshot } from '../lib/creatorProcessingQuota'

describe('creator processing quota', () => {
  it('returns remaining credits inside the current calendar month', () => {
    const snapshot = getCreatorProcessingQuotaSnapshot({
      plan: 'PRO',
      used: 7,
      resetAt: '2026-04-01T00:00:00.000Z',
      now: new Date('2026-04-11T12:00:00.000Z'),
    })

    expect(snapshot.limit).toBe(20)
    expect(snapshot.used).toBe(7)
    expect(snapshot.remaining).toBe(13)
    expect(snapshot.shouldPersistReset).toBe(false)
  })

  it('resets usage when the stored reset timestamp is from a prior month', () => {
    const snapshot = getCreatorProcessingQuotaSnapshot({
      plan: 'FREE',
      used: 3,
      resetAt: '2026-03-01T00:00:00.000Z',
      now: new Date('2026-04-11T12:00:00.000Z'),
    })

    expect(snapshot.limit).toBe(3)
    expect(snapshot.used).toBe(0)
    expect(snapshot.remaining).toBe(3)
    expect(snapshot.shouldPersistReset).toBe(true)
  })
})
