import { describe, it, expect } from 'vitest'
import {
  buildInsightStatusDisplay,
  buildBenchmarkNote,
  rankBriefsByScore,
  parseBrief,
  scoreTone,
  scoreLabel,
  parseTopPatterns,
  parseAudienceDemands,
  type ContentBriefRow,
  type AnalysisStatus,
} from '@/lib/channelInsights'

// ─── buildInsightStatusDisplay ────────────────────────────────────────────────

describe('buildInsightStatusDisplay', () => {
  it('returns canTrigger=false when ANALYZING', () => {
    const d = buildInsightStatusDisplay('ANALYZING')
    expect(d.canTrigger).toBe(false)
    expect(d.tone).toBe('amber')
    expect(d.label).toBe('Analyzing')
  })

  it('returns canTrigger=false when QUEUED', () => {
    const d = buildInsightStatusDisplay('QUEUED')
    expect(d.canTrigger).toBe(false)
    expect(d.tone).toBe('amber')
  })

  it('returns canTrigger=true and emerald when COMPLETE', () => {
    const d = buildInsightStatusDisplay('COMPLETE')
    expect(d.canTrigger).toBe(true)
    expect(d.tone).toBe('emerald')
    expect(d.label).toBe('Ready')
  })

  it('returns canTrigger=true and rose when FAILED', () => {
    const d = buildInsightStatusDisplay('FAILED')
    expect(d.canTrigger).toBe(true)
    expect(d.tone).toBe('rose')
  })

  it('returns slate with canTrigger=true for null (no analysis yet)', () => {
    const d = buildInsightStatusDisplay(null)
    expect(d.canTrigger).toBe(true)
    expect(d.tone).toBe('slate')
    expect(d.label).toBe('Not analyzed yet')
  })

  it('returns a non-empty description for every status', () => {
    const statuses: (AnalysisStatus | null)[] = ['PENDING', 'QUEUED', 'ANALYZING', 'COMPLETE', 'FAILED', null]
    for (const s of statuses) {
      expect(buildInsightStatusDisplay(s).description.length).toBeGreaterThan(5)
    }
  })
})

// ─── parseBrief ───────────────────────────────────────────────────────────────

const RAW_BRIEF: ContentBriefRow = {
  id: 'b1',
  title: 'Japan on a Budget',
  hookIdeas: JSON.stringify(['Open with cost reveal', 'Ask the question']),
  contentOutline: JSON.stringify(['Day 1 Tokyo', 'Day 2 Kyoto', 'Final cost breakdown']),
  trendSignal: 'Japan tourism at all-time high',
  audienceSignal: 'Top comment request: budget breakdown',
  estimatedScore: 78,
  reasoning: 'Budget content outperforms by 3x for this creator.',
  createdAt: null,
}

describe('parseBrief', () => {
  it('parses JSON-stringified hookIdeas into string array', () => {
    const parsed = parseBrief(RAW_BRIEF)
    expect(parsed.hookIdeas).toEqual(['Open with cost reveal', 'Ask the question'])
  })

  it('parses JSON-stringified contentOutline into string array', () => {
    const parsed = parseBrief(RAW_BRIEF)
    expect(parsed.contentOutline).toEqual(['Day 1 Tokyo', 'Day 2 Kyoto', 'Final cost breakdown'])
  })

  it('handles already-parsed array input (Prisma may return parsed JSON)', () => {
    const brief: ContentBriefRow = {
      ...RAW_BRIEF,
      hookIdeas: ['Hook A', 'Hook B'],
      contentOutline: ['Section 1'],
    }
    const parsed = parseBrief(brief)
    expect(parsed.hookIdeas).toEqual(['Hook A', 'Hook B'])
    expect(parsed.contentOutline).toEqual(['Section 1'])
  })

  it('returns empty arrays for missing or null fields', () => {
    const brief: ContentBriefRow = { ...RAW_BRIEF, hookIdeas: null, contentOutline: undefined }
    const parsed = parseBrief(brief as any)
    expect(parsed.hookIdeas).toEqual([])
    expect(parsed.contentOutline).toEqual([])
  })

  it('returns empty array for invalid JSON string', () => {
    const brief: ContentBriefRow = { ...RAW_BRIEF, hookIdeas: 'not json', contentOutline: '{bad}' }
    const parsed = parseBrief(brief)
    expect(parsed.hookIdeas).toEqual([])
    expect(parsed.contentOutline).toEqual([])
  })

  it('filters non-string items from arrays', () => {
    const brief: ContentBriefRow = {
      ...RAW_BRIEF,
      hookIdeas: [42, 'valid', null, 'also valid'] as any,
    }
    const parsed = parseBrief(brief)
    expect(parsed.hookIdeas).toEqual(['valid', 'also valid'])
  })
})

// ─── rankBriefsByScore ────────────────────────────────────────────────────────

describe('rankBriefsByScore', () => {
  it('sorts briefs by estimatedScore descending', () => {
    const briefs: ContentBriefRow[] = [
      { ...RAW_BRIEF, id: 'b1', estimatedScore: 55, hookIdeas: '[]', contentOutline: '[]' },
      { ...RAW_BRIEF, id: 'b2', estimatedScore: 82, hookIdeas: '[]', contentOutline: '[]' },
      { ...RAW_BRIEF, id: 'b3', estimatedScore: 70, hookIdeas: '[]', contentOutline: '[]' },
    ]
    const ranked = rankBriefsByScore(briefs)
    expect(ranked[0].id).toBe('b2')
    expect(ranked[1].id).toBe('b3')
    expect(ranked[2].id).toBe('b1')
  })

  it('returns empty array for empty input', () => {
    expect(rankBriefsByScore([])).toEqual([])
  })

  it('returns parsed briefs (not raw ContentBriefRow)', () => {
    const ranked = rankBriefsByScore([RAW_BRIEF])
    expect(Array.isArray(ranked[0].hookIdeas)).toBe(true)
  })
})

// ─── scoreTone + scoreLabel ───────────────────────────────────────────────────

describe('scoreTone', () => {
  it('returns emerald for score >= 70', () => {
    expect(scoreTone(70)).toBe('emerald')
    expect(scoreTone(82)).toBe('emerald')
    expect(scoreTone(100)).toBe('emerald')
  })

  it('returns amber for score 50-69', () => {
    expect(scoreTone(50)).toBe('amber')
    expect(scoreTone(60)).toBe('amber')
    expect(scoreTone(69)).toBe('amber')
  })

  it('returns slate for score below 50', () => {
    expect(scoreTone(49)).toBe('slate')
    expect(scoreTone(0)).toBe('slate')
  })
})

describe('scoreLabel', () => {
  it('returns High potential for 70+', () => {
    expect(scoreLabel(75)).toBe('High potential')
  })

  it('returns Solid candidate for 50-69', () => {
    expect(scoreLabel(60)).toBe('Solid candidate')
  })

  it('returns Worth exploring for below 50', () => {
    expect(scoreLabel(30)).toBe('Worth exploring')
  })
})

// ─── parseTopPatterns ─────────────────────────────────────────────────────────

describe('parseTopPatterns', () => {
  it('returns empty object for null', () => {
    expect(parseTopPatterns(null)).toEqual({})
  })

  it('parses JSON string into object', () => {
    const result = parseTopPatterns(JSON.stringify({ channel_niche: 'budget travel' }))
    expect(result.channel_niche).toBe('budget travel')
  })

  it('passes through already-parsed object', () => {
    const obj = { channel_niche: 'luxury travel', top_patterns: ['Opens with hook'] }
    expect(parseTopPatterns(obj)).toEqual(obj)
  })

  it('returns empty object for invalid JSON string', () => {
    expect(parseTopPatterns('not json')).toEqual({})
  })

  it('returns empty object for array input (not a patterns object)', () => {
    expect(parseTopPatterns(['a', 'b'])).toEqual({})
  })
})

// ─── parseAudienceDemands ─────────────────────────────────────────────────────

describe('parseAudienceDemands', () => {
  it('returns empty object for null', () => {
    expect(parseAudienceDemands(null)).toEqual({})
  })

  it('parses JSON string into object', () => {
    const data = { top_topics: [{ topic: 'budget', frequency: 'high', example_comment: 'How much?' }] }
    const result = parseAudienceDemands(JSON.stringify(data))
    expect(result.top_topics).toHaveLength(1)
    expect(result.top_topics![0].topic).toBe('budget')
  })

  it('passes through already-parsed object', () => {
    const obj = { recurring_questions: ['How much did you spend?'] }
    expect(parseAudienceDemands(obj)).toEqual(obj)
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseAudienceDemands('{bad json')).toEqual({})
  })
})

// ─── buildBenchmarkNote ───────────────────────────────────────────────────────

describe('buildBenchmarkNote', () => {
  it('returns show=false when usedBenchmarks is false', () => {
    const note = buildBenchmarkNote(false, 15)
    expect(note.show).toBe(false)
    expect(note.text).toBe('')
  })

  it('returns show=false when benchmarkVideoCount is zero', () => {
    const note = buildBenchmarkNote(true, 0)
    expect(note.show).toBe(false)
  })

  it('returns show=true with count in text when benchmarks were used', () => {
    const note = buildBenchmarkNote(true, 12)
    expect(note.show).toBe(true)
    expect(note.text).toContain('12')
    expect(note.text.length).toBeGreaterThan(10)
  })

  it('returns show=false for null-ish inputs', () => {
    expect(buildBenchmarkNote(false, 0).show).toBe(false)
  })
})
