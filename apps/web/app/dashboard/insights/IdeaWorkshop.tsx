'use client'

import { useState } from 'react'
import {
  IDEA_WORKSHOP_MIN_CHARS,
  IDEA_WORKSHOP_MAX_CHARS,
} from '@/lib/ideaWorkshop'

type ContentEnhancement = {
  suggestion: string
  why: string
  how: string
}

type IdeaQuota = { limit: number; used: number; remaining: number; resetAt: string }

type NicheTrendSignal = { topic: string; momentum: string | null; score: number | null }
type GapSignal = { topic: string; momentum: string | null; coverageCount: number | null }
type LiveSignals = { nicheTrends: NicheTrendSignal[]; gaps: GapSignal[] }

type AugmentationResult = {
  id: string | null
  refinedTitles: string[]
  hookConcepts: string[]
  contentEnhancements: ContentEnhancement[]
  audienceConnections: string[]
  nicheLearnings: string[]
  overallAssessment: string
  confidenceScore: number
  liveSignals?: LiveSignals
  quota?: IdeaQuota
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? 'text-emerald-700 bg-emerald-50 ring-emerald-200'
    : score >= 50 ? 'text-amber-700 bg-amber-50 ring-amber-200'
    : 'text-[#17332d]/66 bg-[#17332d]/6 ring-[#17332d]/12'
  const label =
    score >= 70 ? 'Strong fit'
    : score >= 50 ? 'Solid potential'
    : 'Worth refining'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ${color}`}>
      {label} · {score}/100
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dashboard-mirror-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-[#17332d]">{title}</h3>
      {children}
    </div>
  )
}

export function IdeaWorkshop({ hasInsights }: { hasInsights: boolean }) {
  const [idea, setIdea] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AugmentationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filming, setFilming] = useState(false)
  const [filmingDone, setFilmingDone] = useState(false)
  const [filmingError, setFilmingError] = useState<string | null>(null)
  const [quota, setQuota] = useState<IdeaQuota | null>(null)

  const trimmedLength = idea.trim().length
  const tooShort = trimmedLength < IDEA_WORKSHOP_MIN_CHARS
  const tooLong = idea.length > IDEA_WORKSHOP_MAX_CHARS
  const quotaExhausted = quota != null && quota.remaining <= 0

  async function startFilming() {
    if (!result || filming) return
    setFilming(true)
    setFilmingError(null)
    try {
      const res = await fetch('/api/insights/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: result.refinedTitles[0] ?? idea.trim(),
          hookIdeas: result.hookConcepts,
          contentOutline: result.contentEnhancements.map((e) => e.suggestion),
          reasoning: result.overallAssessment,
          estimatedScore: result.confidenceScore,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFilmingError(data.error ?? 'Could not save brief. Try again.')
      } else {
        setFilmingDone(true)
      }
    } catch {
      setFilmingError('Connection error. Please try again.')
    } finally {
      setFilming(false)
    }
  }

  async function submit() {
    if (tooShort || tooLong || loading) return
    setLoading(true)
    setResult(null)
    setError(null)
    setFilmingDone(false)
    setFilmingError(null)
    try {
      const res = await fetch('/api/insights/augment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.')
        if (data.quota) setQuota(data.quota as IdeaQuota)
      } else {
        setResult(data as AugmentationResult)
        if (data.quota) setQuota(data.quota as IdeaQuota)
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-mirror-card">
      {/* Header */}
      <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
        <p className="dashboard-mirror-kicker text-xs">Idea Workshop</p>
        <h2 className="mt-1 font-semibold text-[#17332d]">
          Have a rough idea? Let's make it great.
        </h2>
        <p className="dashboard-mirror-subtle mt-1 text-xs">
          Describe your concept and get personalized recommendations — grounded in what works
          for your channel and your niche.
        </p>
      </div>

      {/* Input */}
      <div className="p-5">
        {!hasInsights && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <svg viewBox="0 0 16 16" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
              <path d="M8 5.5v3" /><path d="M8 10.5v.5" />
            </svg>
            <p className="text-xs text-amber-700">
              Run a channel analysis first for the most personalized recommendations.
              We can still help, but results will be less tailored.
            </p>
          </div>
        )}

        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. I want to do a video about visiting Japan on a budget — I'm thinking a 10-day itinerary with a cost breakdown at the end, but not sure how to structure the hook or title..."
          rows={4}
          maxLength={IDEA_WORKSHOP_MAX_CHARS}
          className="w-full resize-none rounded-lg border border-[#17332d]/12 bg-[#17332d]/4 px-3.5 py-3 text-sm text-[#17332d] placeholder:text-[#17332d]/35 focus:border-[#17332d]/30 focus:outline-none"
          disabled={loading}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className={`text-xs ${idea.length > IDEA_WORKSHOP_MAX_CHARS * 0.9 ? 'text-rose-500' : 'text-[#17332d]/40'}`}>
            {idea.length}/{IDEA_WORKSHOP_MAX_CHARS}
          </span>
          <button
            onClick={submit}
            disabled={loading || tooShort || tooLong || quotaExhausted}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Thinking…
              </span>
            ) : (
              'Augment my idea'
            )}
          </button>
        </div>
        {quota && (
          <p className="mt-2 text-right text-xs text-[#17332d]/45">
            {quotaExhausted
              ? 'Daily limit reached — resets tomorrow.'
              : `${quota.remaining} of ${quota.limit} runs left today`}
          </p>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-5 mb-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs text-rose-600">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="border-t border-[rgba(214,205,184,0.08)] p-5 space-y-4">
          {/* Overall assessment + score */}
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-[#17332d]/80 leading-relaxed">{result.overallAssessment}</p>
            <div className="shrink-0">
              <ScoreBadge score={result.confidenceScore} />
            </div>
          </div>

          {/* Live signals — show creators *why* this is grounded in their niche right now */}
          {result.liveSignals &&
            (result.liveSignals.nicheTrends.length > 0 || result.liveSignals.gaps.length > 0) && (
              <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Grounded in your niche right now
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.liveSignals.nicheTrends.map((t, i) => (
                    <span
                      key={`t-${i}`}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-[#17332d]/75 ring-1 ring-emerald-200"
                    >
                      {t.momentum === 'RISING' && <span className="text-emerald-600">↑</span>}
                      {t.topic}
                    </span>
                  ))}
                  {result.liveSignals.gaps.map((g, i) => (
                    <span
                      key={`g-${i}`}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-amber-700 ring-1 ring-amber-200"
                      title={`You cover ${g.coverageCount ?? 0} video(s) on this`}
                    >
                      whitespace · {g.topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {/* Refined titles */}
          {result.refinedTitles.length > 0 && (
            <Section title="Refined title options">
              <ol className="space-y-2">
                {result.refinedTitles.map((t, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 w-4 shrink-0 text-xs font-medium text-[#17332d]/40">{i + 1}.</span>
                    <span className="text-sm text-[#17332d]">{t}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Hook concepts */}
          {result.hookConcepts.length > 0 && (
            <Section title="Opening hooks to try">
              <ul className="space-y-2">
                {result.hookConcepts.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#17332d]/76">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#17332d]/30" />
                    {h}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Content enhancements */}
          {result.contentEnhancements.length > 0 && (
            <Section title="How to make it stronger">
              <div className="space-y-4">
                {result.contentEnhancements.map((e, i) => (
                  <div key={i} className="rounded-lg border border-[#17332d]/10 bg-[#17332d]/3 p-4">
                    <p className="mb-1 text-sm font-medium text-[#17332d]">{e.suggestion}</p>
                    <p className="text-xs text-[#17332d]/60">
                      <span className="font-medium text-[#17332d]/50">Why: </span>{e.why}
                    </p>
                    <p className="mt-1 text-xs text-[#17332d]/60">
                      <span className="font-medium text-[#17332d]/50">How: </span>{e.how}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Audience connections + niche learnings side by side */}
          {(result.audienceConnections.length > 0 || result.nicheLearnings.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {result.audienceConnections.length > 0 && (
                <Section title="Your audience wants this">
                  <ul className="space-y-2">
                    {result.audienceConnections.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#17332d]/76">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {result.nicheLearnings.length > 0 && (
                <Section title="What top creators in your niche do">
                  <ul className="space-y-2">
                    {result.nicheLearnings.map((n, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#17332d]/76">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        {n}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}

          {/* Start Filming CTA */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#17332d]/10 bg-[#17332d]/3 px-4 py-3">
            {filmingDone ? (
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                  <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3 text-emerald-600" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                </span>
                <p className="text-sm font-medium text-[#17332d]">
                  Added to your briefs as <span className="text-emerald-700">Filming</span> — good luck!
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-[#17332d]">Ready to film this?</p>
                  <p className="mt-0.5 text-xs text-[#17332d]/55">
                    Save it to your briefs and mark it as filming to track it through to publish.
                  </p>
                  {filmingError && (
                    <p className="mt-1 text-xs text-rose-500">{filmingError}</p>
                  )}
                </div>
                <button
                  onClick={startFilming}
                  disabled={filming}
                  className="btn-primary shrink-0 text-sm disabled:opacity-50"
                >
                  {filming ? (
                    <span className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Saving…
                    </span>
                  ) : (
                    '🎬 Start filming'
                  )}
                </button>
              </>
            )}
          </div>

          {/* Try another idea */}
          <button
            onClick={() => { setResult(null); setIdea('') }}
            className="dashboard-mirror-subtle text-xs hover:text-[#17332d] underline underline-offset-2"
          >
            Try another idea
          </button>
        </div>
      )}
    </div>
  )
}
