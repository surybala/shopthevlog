import { describe, expect, it } from 'vitest'
import {
  IDEA_WORKSHOP_MIN_CHARS,
  IDEA_WORKSHOP_MAX_CHARS,
  validateIdeaLength,
  getIdeaWorkshopDailyLimit,
  utcDayStart,
  nextUtcDayStart,
  resolveIdeaQuota,
} from '../lib/ideaWorkshop'

describe('validateIdeaLength', () => {
  it('rejects ideas below the minimum', () => {
    const res = validateIdeaLength('too short')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(new RegExp(`${IDEA_WORKSHOP_MIN_CHARS} characters`))
  })

  it('counts trimmed length for the minimum', () => {
    // 14 visible chars wrapped in whitespace is still too short
    expect(validateIdeaLength(`   ${'a'.repeat(14)}   `).ok).toBe(false)
  })

  it('rejects ideas above the maximum (raw length)', () => {
    const res = validateIdeaLength('x'.repeat(IDEA_WORKSHOP_MAX_CHARS + 1))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(new RegExp(`under ${IDEA_WORKSHOP_MAX_CHARS}`))
  })

  it('accepts a well-formed idea', () => {
    expect(validateIdeaLength('A 10-day budget Japan itinerary with a cost breakdown').ok).toBe(true)
  })

  it('accepts exactly at the boundaries', () => {
    expect(validateIdeaLength('a'.repeat(IDEA_WORKSHOP_MIN_CHARS)).ok).toBe(true)
    expect(validateIdeaLength('a'.repeat(IDEA_WORKSHOP_MAX_CHARS)).ok).toBe(true)
  })
})

describe('getIdeaWorkshopDailyLimit', () => {
  it('returns tier-specific limits', () => {
    expect(getIdeaWorkshopDailyLimit('FREE')).toBe(10)
    expect(getIdeaWorkshopDailyLimit('PRO')).toBe(100)
    expect(getIdeaWorkshopDailyLimit('STUDIO')).toBe(500)
  })

  it('falls back to the free limit for unknown plans', () => {
    expect(getIdeaWorkshopDailyLimit(undefined)).toBe(10)
    expect(getIdeaWorkshopDailyLimit('ENTERPRISE')).toBe(10)
  })

  it('keeps daily limits monotonic across tiers', () => {
    expect(getIdeaWorkshopDailyLimit('FREE')).toBeLessThan(getIdeaWorkshopDailyLimit('PRO'))
    expect(getIdeaWorkshopDailyLimit('PRO')).toBeLessThan(getIdeaWorkshopDailyLimit('STUDIO'))
  })
})

describe('utc day boundaries', () => {
  it('computes the start of the current UTC day', () => {
    const start = utcDayStart(new Date('2026-06-15T18:30:00.000Z'))
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })

  it('computes the next UTC day start', () => {
    const next = nextUtcDayStart(new Date('2026-06-15T18:30:00.000Z'))
    expect(next.toISOString()).toBe('2026-06-16T00:00:00.000Z')
  })

  it('rolls over month boundaries', () => {
    expect(nextUtcDayStart(new Date('2026-06-30T23:59:00.000Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('resolveIdeaQuota', () => {
  const now = new Date('2026-06-15T12:00:00.000Z')

  it('reports remaining runs under the limit', () => {
    const q = resolveIdeaQuota('PRO', 40, now)
    expect(q).toMatchObject({ limit: 100, used: 40, remaining: 60, exceeded: false })
    expect(q.resetAt.toISOString()).toBe('2026-06-16T00:00:00.000Z')
  })

  it('marks the quota exceeded at the limit', () => {
    const q = resolveIdeaQuota('FREE', 10, now)
    expect(q.exceeded).toBe(true)
    expect(q.remaining).toBe(0)
  })

  it('clamps negative usage to zero', () => {
    expect(resolveIdeaQuota('FREE', -5, now).used).toBe(0)
  })

  it('never reports negative remaining when over the limit', () => {
    expect(resolveIdeaQuota('FREE', 25, now).remaining).toBe(0)
  })
})
