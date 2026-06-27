// Pure helpers for the brief outcome loop (Phase 3).
// When a content brief is linked to a published vlog, we measure how it actually
// performed against the creator's baseline so future predictions can be calibrated.
// No side effects — deterministic transformations only.

export function median(values: number[]): number {
  const nums = values
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => a - b)
  if (nums.length === 0) return 0
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

// Relative performance vs the creator's typical video: +0.5 == 50% above median.
// Returns null when there is no baseline to compare against.
export function computeOutcomeDelta(
  vlogViews: number,
  baselineMedian: number,
): number | null {
  if (!baselineMedian || baselineMedian <= 0) return null
  return (vlogViews - baselineMedian) / baselineMedian
}

// Map a relative delta onto a 0–100 score so it is comparable with estimatedScore.
// tanh keeps it bounded and smooth: delta 0 → 50, +1.0 (2× baseline) → ~88,
// -1.0 → ~12. Clamped to [0, 100].
export function outcomeToScore(delta: number | null): number | null {
  if (delta === null) return null
  const score = Math.round(50 + 50 * Math.tanh(delta))
  return Math.max(0, Math.min(100, score))
}

export type BriefOutcome = {
  actualScore: number | null
  outcomeDelta: number | null
}

// Measure a published vlog against the creator's other videos.
export function computeBriefOutcome(
  vlogViews: number,
  otherVlogViews: number[],
): BriefOutcome {
  const baseline = median(otherVlogViews)
  const outcomeDelta = computeOutcomeDelta(vlogViews, baseline)
  return { outcomeDelta, actualScore: outcomeToScore(outcomeDelta) }
}
