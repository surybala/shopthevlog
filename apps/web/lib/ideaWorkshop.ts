// Throttling controls for the Idea Workshop (shared by the API route and UI).
//
// Two guards keep the workshop a focused brainstorming tool rather than a
// general-purpose LLM prompt box:
//   1. Character bounds — long enough to be a real idea, short enough to stay
//      a brainstorm (and to cap per-request token spend).
//   2. Per-tier daily request quotas — bound total token usage by plan.
// All helpers are pure so they can be unit-tested and reused on the client.

import { getCreatorPlanConfig } from './creatorPlans'

// Min: enough words to be a meaningful idea, not "japan" or "help me".
// Max: a few focused sentences; discourages pasting essays / generic prompts
// and caps the input tokens of every request.
export const IDEA_WORKSHOP_MIN_CHARS = 15
export const IDEA_WORKSHOP_MAX_CHARS = 1000

export type IdeaLengthValidation = { ok: boolean; error?: string }

export function validateIdeaLength(idea: string): IdeaLengthValidation {
  const trimmedLength = idea.trim().length
  if (trimmedLength < IDEA_WORKSHOP_MIN_CHARS) {
    return {
      ok: false,
      error: `Describe your idea in at least ${IDEA_WORKSHOP_MIN_CHARS} characters so we have something to work with.`,
    }
  }
  // Guard against raw length so padded whitespace can't smuggle a huge prompt.
  if (idea.length > IDEA_WORKSHOP_MAX_CHARS) {
    return {
      ok: false,
      error: `Keep your idea under ${IDEA_WORKSHOP_MAX_CHARS} characters — the workshop is for focused brainstorming, not long prompts.`,
    }
  }
  return { ok: true }
}

export function getIdeaWorkshopDailyLimit(plan: string | null | undefined): number {
  return getCreatorPlanConfig(plan).ideaWorkshopDailyLimit
}

export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

export function nextUtcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0))
}

export type IdeaQuota = {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  exceeded: boolean
}

// Resolve a creator's Idea Workshop quota for the current UTC day given how many
// requests they've already made today.
export function resolveIdeaQuota(
  plan: string | null | undefined,
  usedToday: number,
  now: Date = new Date(),
): IdeaQuota {
  const limit = getIdeaWorkshopDailyLimit(plan)
  const used = Math.max(usedToday, 0)
  return {
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    resetAt: nextUtcDayStart(now),
    exceeded: used >= limit,
  }
}
