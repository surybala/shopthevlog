import { describe, expect, it } from 'vitest'
import {
  median,
  computeOutcomeDelta,
  outcomeToScore,
  computeBriefOutcome,
} from '../lib/briefOutcomes'

describe('median', () => {
  it('returns 0 for empty input', () => {
    expect(median([])).toBe(0)
  })

  it('returns the middle value for odd counts', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the two middle values for even counts', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('ignores NaN values', () => {
    expect(median([10, NaN, 30])).toBe(20)
  })
})

describe('computeOutcomeDelta', () => {
  it('returns null when there is no baseline', () => {
    expect(computeOutcomeDelta(1000, 0)).toBeNull()
    expect(computeOutcomeDelta(1000, -5)).toBeNull()
  })

  it('returns 0 when views equal the baseline', () => {
    expect(computeOutcomeDelta(1000, 1000)).toBe(0)
  })

  it('returns a positive delta when above baseline', () => {
    expect(computeOutcomeDelta(2000, 1000)).toBe(1)
  })

  it('returns a negative delta when below baseline', () => {
    expect(computeOutcomeDelta(500, 1000)).toBe(-0.5)
  })
})

describe('outcomeToScore', () => {
  it('returns null for null delta', () => {
    expect(outcomeToScore(null)).toBeNull()
  })

  it('maps a zero delta to 50', () => {
    expect(outcomeToScore(0)).toBe(50)
  })

  it('maps a strong positive delta toward the top of the range', () => {
    expect(outcomeToScore(1)).toBe(88)
  })

  it('maps a strong negative delta toward the bottom of the range', () => {
    expect(outcomeToScore(-1)).toBe(12)
  })

  it('clamps extreme values to [0, 100]', () => {
    expect(outcomeToScore(100)).toBeLessThanOrEqual(100)
    expect(outcomeToScore(-100)).toBeGreaterThanOrEqual(0)
  })
})

describe('computeBriefOutcome', () => {
  it('measures a published vlog against its peers', () => {
    const out = computeBriefOutcome(20000, [10000, 10000])
    expect(out.outcomeDelta).toBe(1)
    expect(out.actualScore).toBe(88)
  })

  it('returns nulls when there is no baseline', () => {
    const out = computeBriefOutcome(20000, [])
    expect(out.outcomeDelta).toBeNull()
    expect(out.actualScore).toBeNull()
  })
})
