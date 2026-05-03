// Dashboard: Creator Growth Insights
// Server component — fetches ChannelInsight + ContentBriefs at render time.
// Uses the same CSS class conventions as analytics/page.tsx.

import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import {
  buildInsightStatusDisplay,
  buildBenchmarkNote,
  rankBriefsByScore,
  scoreTone,
  scoreLabel,
  parseTopPatterns,
  parseAudienceDemands,
  type AnalysisStatus,
  type ParsedContentBrief,
} from '@/lib/channelInsights'
import TriggerAnalysisButton from './TriggerAnalysisButton'

export default async function InsightsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const insight = await prisma.channelInsight.findUnique({
    where: { creatorId: creator.id },
    include: { briefs: { orderBy: { estimatedScore: 'desc' } } },
  })

  const status = (insight?.status ?? null) as AnalysisStatus | null
  const statusDisplay = buildInsightStatusDisplay(status)
  const patterns = parseTopPatterns(insight?.topPatterns)
  const audience = parseAudienceDemands(insight?.audienceDemands)
  const briefs = insight ? rankBriefsByScore(insight.briefs as any) : []
  const benchmarkNote = buildBenchmarkNote(
    insight?.usedBenchmarks ?? false,
    insight?.benchmarkVideoCount ?? 0,
  )

  const toneClasses: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    slate: 'bg-[#17332d]/6 text-[#17332d]/66 ring-1 ring-[#17332d]/12',
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="dashboard-mirror-panel mb-8 p-6">
        <p className="dashboard-mirror-kicker text-xs">Growth Intelligence</p>
        <h1 className="mt-3 text-3xl font-bold text-[#17332d]">
          Understand what's working and what to create next.
        </h1>
        <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
          AI analyzes your top and bottom performing videos, mines your audience comments,
          and generates personalized content briefs — so your next video has a plan.
        </p>

        <div className="mt-5 flex items-center gap-4">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${toneClasses[statusDisplay.tone]}`}>
            {statusDisplay.label}
          </span>
          {insight?.analyzedAt && (
            <span className="dashboard-mirror-muted text-xs">
              Last analyzed {new Date(insight.analyzedAt).toLocaleDateString()}
              {' · '}{insight.analyzedVideoCount} videos
            </span>
          )}
        </div>

        <div className="mt-4">
          <TriggerAnalysisButton
            canTrigger={statusDisplay.canTrigger}
            isRunning={status === 'ANALYZING' || status === 'QUEUED'}
            description={statusDisplay.description}
          />
        </div>
      </div>

      {/* No data yet */}
      {!insight || status === 'PENDING' || status === 'FAILED' ? (
        <div className="dashboard-mirror-card p-10 text-center">
          <p className="text-sm font-medium text-[#17332d]">
            {status === 'FAILED'
              ? 'The last analysis did not complete. Click "Run Analysis" to try again.'
              : 'Run your first analysis to see personalized insights and content briefs.'}
          </p>
          <p className="dashboard-mirror-subtle mt-2 text-xs">
            You need at least 5 imported vlogs with view counts for meaningful results.
          </p>
        </div>
      ) : status === 'QUEUED' || status === 'ANALYZING' ? (
        <div className="dashboard-mirror-card p-10 text-center">
          <p className="text-sm font-medium text-[#17332d]">Analysis is running…</p>
          <p className="dashboard-mirror-subtle mt-2 text-xs">
            This usually takes 1–2 minutes. The page will update automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Channel profile */}
          {(patterns.channel_niche || patterns.creator_archetype) && (
            <div className="dashboard-mirror-card mb-6 p-6">
              <h2 className="mb-3 font-semibold text-[#17332d]">Your Channel Profile</h2>
              <div className="flex flex-wrap gap-3">
                {patterns.channel_niche && (
                  <div>
                    <p className="dashboard-mirror-kicker text-xs">Niche</p>
                    <p className="mt-1 text-sm font-medium text-[#17332d]">{patterns.channel_niche}</p>
                  </div>
                )}
                {patterns.creator_archetype && (
                  <div className="ml-8">
                    <p className="dashboard-mirror-kicker text-xs">Archetype</p>
                    <p className="mt-1 text-sm font-medium text-[#17332d]">{patterns.creator_archetype}</p>
                  </div>
                )}
              </div>
              {benchmarkNote.show && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#17332d]/10 bg-[#17332d]/4 px-3 py-2">
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-[#17332d]/50" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                    <path d="M8 5.5v.5" />
                    <path d="M8 8v3.5" />
                  </svg>
                  <p className="text-xs text-[#17332d]/60">{benchmarkNote.text}</p>
                </div>
              )}
            </div>
          )}

          {/* Content patterns */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            {(patterns.top_patterns ?? []).length > 0 && (
              <div className="dashboard-mirror-card p-5">
                <h2 className="mb-3 font-semibold text-[#17332d]">What's working</h2>
                <ul className="space-y-2">
                  {(patterns.top_patterns ?? []).map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[#17332d]/76">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(patterns.content_gaps ?? []).length > 0 && (
              <div className="dashboard-mirror-card p-5">
                <h2 className="mb-3 font-semibold text-[#17332d]">Content gaps</h2>
                <ul className="space-y-2">
                  {(patterns.content_gaps ?? []).map((g, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[#17332d]/76">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Audience demand signals */}
          {((audience.top_topics ?? []).length > 0 || (audience.recurring_questions ?? []).length > 0) && (
            <div className="dashboard-mirror-card mb-6 p-6">
              <h2 className="mb-4 font-semibold text-[#17332d]">What your audience wants</h2>
              <div className="grid grid-cols-2 gap-6">
                {(audience.top_topics ?? []).length > 0 && (
                  <div>
                    <p className="dashboard-mirror-kicker mb-3 text-xs">Top comment topics</p>
                    <div className="space-y-3">
                      {(audience.top_topics ?? []).map((t, i) => (
                        <div key={i}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-[#17332d]">{t.topic}</span>
                            <span className={`text-xs ${
                              t.frequency === 'high'
                                ? 'text-emerald-600'
                                : t.frequency === 'medium'
                                ? 'text-amber-600'
                                : 'text-[#17332d]/50'
                            }`}>
                              {t.frequency}
                            </span>
                          </div>
                          {t.example_comment && (
                            <p className="mt-0.5 text-xs text-[#17332d]/50 italic">
                              "{t.example_comment}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(audience.recurring_questions ?? []).length > 0 && (
                  <div>
                    <p className="dashboard-mirror-kicker mb-3 text-xs">Recurring questions</p>
                    <ul className="space-y-2">
                      {(audience.recurring_questions ?? []).map((q, i) => (
                        <li key={i} className="text-sm text-[#17332d]/76">• {q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Content briefs */}
          {briefs.length > 0 && (
            <div className="dashboard-mirror-card">
              <div className="border-b border-[rgba(214,205,184,0.08)] p-5">
                <h2 className="font-semibold text-[#17332d]">Your next 4 video ideas</h2>
                <p className="dashboard-mirror-subtle mt-1 text-xs">
                  Ranked by predicted performance against your channel baseline.
                </p>
              </div>
              <div className="divide-y divide-[rgba(214,205,184,0.08)]">
                {briefs.map((brief, i) => (
                  <BriefCard key={brief.id} brief={brief} rank={i + 1} toneClasses={toneClasses} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BriefCard({
  brief,
  rank,
  toneClasses,
}: {
  brief: ParsedContentBrief
  rank: number
  toneClasses: Record<string, string>
}) {
  const tone = scoreTone(brief.estimatedScore)
  const label = scoreLabel(brief.estimatedScore)

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="dashboard-mirror-muted mt-0.5 text-xs font-medium">#{rank}</span>
          <div>
            <h3 className="font-semibold text-[#17332d]">{brief.title}</h3>
            {brief.reasoning && (
              <p className="dashboard-mirror-subtle mt-1 text-xs">{brief.reasoning}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
            {label}
          </span>
          <p className="dashboard-mirror-muted mt-1 text-xs">{brief.estimatedScore}/100</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {brief.hookIdeas.length > 0 && (
          <div>
            <p className="dashboard-mirror-kicker mb-2 text-xs">Hook ideas</p>
            <ul className="space-y-1">
              {brief.hookIdeas.map((h, i) => (
                <li key={i} className="text-xs text-[#17332d]/76">• {h}</li>
              ))}
            </ul>
          </div>
        )}

        {brief.contentOutline.length > 0 && (
          <div>
            <p className="dashboard-mirror-kicker mb-2 text-xs">Content outline</p>
            <ol className="space-y-1">
              {brief.contentOutline.map((section, i) => (
                <li key={i} className="text-xs text-[#17332d]/76">{i + 1}. {section}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {(brief.trendSignal || brief.audienceSignal) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {brief.trendSignal && (
            <span className="rounded-md bg-[#17332d]/6 px-2 py-0.5 text-xs text-[#17332d]/66">
              Trend: {brief.trendSignal}
            </span>
          )}
          {brief.audienceSignal && (
            <span className="rounded-md bg-[#17332d]/6 px-2 py-0.5 text-xs text-[#17332d]/66">
              Audience: {brief.audienceSignal}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
