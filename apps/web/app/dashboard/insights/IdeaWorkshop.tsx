'use client'

import { useState } from 'react'

type ContentEnhancement = {
  suggestion: string
  why: string
  how: string
}

type AugmentationResult = {
  refinedTitles: string[]
  hookConcepts: string[]
  contentEnhancements: ContentEnhancement[]
  audienceConnections: string[]
  nicheLearnings: string[]
  overallAssessment: string
  confidenceScore: number
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

  async function submit() {
    if (idea.trim().length < 10 || loading) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/insights/augment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.')
      } else {
        setResult(data as AugmentationResult)
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
          className="w-full resize-none rounded-lg border border-[#17332d]/12 bg-[#17332d]/4 px-3.5 py-3 text-sm text-[#17332d] placeholder:text-[#17332d]/35 focus:border-[#17332d]/30 focus:outline-none"
          disabled={loading}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className={`text-xs ${idea.length > 1800 ? 'text-rose-500' : 'text-[#17332d]/40'}`}>
            {idea.length}/2000
          </span>
          <button
            onClick={submit}
            disabled={loading || idea.trim().length < 10}
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
