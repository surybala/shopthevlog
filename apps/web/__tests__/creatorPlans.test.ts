import { describe, expect, it } from 'vitest'

import {
  CREATOR_PLAN_CONFIG,
  getCreatorPlanConfig,
  DEFAULT_AUTO_IMPORT_COUNT,
  AUTO_TRANSCRIBE_TOP_N,
  resolveAutoImportCount,
  selectVlogIdsForAutoTranscription,
} from '../lib/creatorPlans'

describe('creator plan config', () => {
  it('returns configured limits for each supported plan', () => {
    expect(CREATOR_PLAN_CONFIG.FREE.maxImportedVlogs).toBe(50)
    expect(CREATOR_PLAN_CONFIG.PRO.maxImportedVlogs).toBe(200)
    expect(CREATOR_PLAN_CONFIG.STUDIO.maxImportedVlogs).toBe(1000)
    expect(CREATOR_PLAN_CONFIG.FREE.monthlyProcessingCredits).toBe(3)
    expect(CREATOR_PLAN_CONFIG.PRO.monthlyProcessingCredits).toBe(20)
    expect(CREATOR_PLAN_CONFIG.STUDIO.monthlyProcessingCredits).toBe(75)
  })

  it('keeps import caps monotonic across tiers (paid > free)', () => {
    expect(CREATOR_PLAN_CONFIG.FREE.maxImportedVlogs).toBeLessThan(CREATOR_PLAN_CONFIG.PRO.maxImportedVlogs)
    expect(CREATOR_PLAN_CONFIG.PRO.maxImportedVlogs).toBeLessThan(CREATOR_PLAN_CONFIG.STUDIO.maxImportedVlogs)
  })

  it('keeps every tier cap at or above the default auto-import count', () => {
    for (const cfg of Object.values(CREATOR_PLAN_CONFIG)) {
      expect(cfg.maxImportedVlogs).toBeGreaterThanOrEqual(DEFAULT_AUTO_IMPORT_COUNT)
    }
  })

  it('falls back to the free plan for unknown values', () => {
    expect(getCreatorPlanConfig('ENTERPRISE')).toEqual(CREATOR_PLAN_CONFIG.FREE)
    expect(getCreatorPlanConfig(undefined)).toEqual(CREATOR_PLAN_CONFIG.FREE)
  })
})

describe('resolveAutoImportCount', () => {
  it('returns the default count when below the plan cap', () => {
    expect(resolveAutoImportCount('PRO')).toBe(DEFAULT_AUTO_IMPORT_COUNT)
    expect(resolveAutoImportCount('FREE')).toBe(DEFAULT_AUTO_IMPORT_COUNT)
  })

  it('never exceeds the plan cap', () => {
    expect(resolveAutoImportCount('FREE')).toBeLessThanOrEqual(CREATOR_PLAN_CONFIG.FREE.maxImportedVlogs)
  })
})

describe('selectVlogIdsForAutoTranscription', () => {
  const vlogs = [
    { videoId: 'a', viewCount: 100 },
    { videoId: 'b', viewCount: 900 },
    { videoId: 'c', viewCount: 500 },
    { videoId: 'd', viewCount: null },
  ]

  it('is disabled by default (AUTO_TRANSCRIBE_TOP_N = 0)', () => {
    expect(AUTO_TRANSCRIBE_TOP_N).toBe(0)
    expect(selectVlogIdsForAutoTranscription(vlogs)).toEqual([])
  })

  it('returns an empty list for non-positive N', () => {
    expect(selectVlogIdsForAutoTranscription(vlogs, 0)).toEqual([])
    expect(selectVlogIdsForAutoTranscription(vlogs, -2)).toEqual([])
  })

  it('selects the top N by view count when enabled', () => {
    expect(selectVlogIdsForAutoTranscription(vlogs, 2)).toEqual(['b', 'c'])
  })

  it('treats missing view counts as zero', () => {
    expect(selectVlogIdsForAutoTranscription(vlogs, 4)).toEqual(['b', 'c', 'a', 'd'])
  })
})
