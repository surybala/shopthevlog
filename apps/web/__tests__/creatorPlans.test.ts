import { describe, expect, it } from 'vitest'

import { CREATOR_PLAN_CONFIG, getCreatorPlanConfig } from '../lib/creatorPlans'

describe('creator plan config', () => {
  it('returns configured limits for each supported plan', () => {
    expect(CREATOR_PLAN_CONFIG.FREE.maxImportedVlogs).toBe(5)
    expect(CREATOR_PLAN_CONFIG.PRO.maxImportedVlogs).toBe(25)
    expect(CREATOR_PLAN_CONFIG.STUDIO.maxImportedVlogs).toBe(100)
  })

  it('falls back to the free plan for unknown values', () => {
    expect(getCreatorPlanConfig('ENTERPRISE')).toEqual(CREATOR_PLAN_CONFIG.FREE)
    expect(getCreatorPlanConfig(undefined)).toEqual(CREATOR_PLAN_CONFIG.FREE)
  })
})
