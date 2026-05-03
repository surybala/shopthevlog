import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rankBriefsByScore, parseTopPatterns, buildStalenessNote } from '@/lib/channelInsights'

export default async function DashboardOverviewPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
  })

  if (!creator) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="mb-3 text-2xl font-bold text-[#17332d]">Welcome to VlogShopper</h1>
          <p className="dashboard-mirror-subtle mb-6 text-sm">
            Set up your creator profile to start growing your channel with AI-powered insights.
          </p>
          <Link href="/dashboard/settings" className="btn-primary">
            Set up your profile
          </Link>
        </div>
      </div>
    )
  }

  const [recentVlogs, insight] = await Promise.all([
    prisma.vlog.findMany({
      where: { creatorId: creator.id },
      orderBy: [{ viewCount: 'desc' }, { publishedAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        viewCount: true,
        likeCount: true,
        publishedAt: true,
        processingStatus: true,
      },
    }),
    prisma.channelInsight.findUnique({
      where: { creatorId: creator.id },
      include: { briefs: { orderBy: { estimatedScore: 'desc' }, take: 1 } },
    }),
  ])

  const totalVlogs = await prisma.vlog.count({ where: { creatorId: creator.id } })
  const topBrief = insight ? rankBriefsByScore(insight.briefs as any)[0] ?? null : null
  const patterns = parseTopPatterns(insight?.topPatterns)
  const insightStatus = insight?.status ?? null
  const insightReady = insightStatus === 'COMPLETE' && topBrief !== null
  const insightRunning = insightStatus === 'QUEUED' || insightStatus === 'ANALYZING'
  const stalenessNote = buildStalenessNote(insight?.analyzedAt ?? null)
  const firstName = creator.displayName.split(' ')[0]

  return (
    <div className="p-8">

      {/* Hero */}
      <div className="dashboard-mirror-panel mb-8 p-7">
        <p className="dashboard-mirror-kicker text-xs">Creator Studio</p>
        <h1 className="mt-3 text-4xl font-bold text-[#17332d]">
          Welcome back, {firstName}
        </h1>
        <p className="dashboard-mirror-subtle mt-2 text-sm">
          {insightReady
            ? `Your channel is a ${patterns.channel_niche ?? 'travel'} channel. Here's what to create next.`
            : totalVlogs === 0
              ? 'Import your videos to unlock AI-powered growth insights.'
              : 'Run a channel analysis to get personalized content ideas.'}
        </p>

        {!creator.youtubeChannelId && (
          <div className="mt-5">
            <Link href="/dashboard/settings" className="btn-primary text-sm">
              Connect YouTube to get started
            </Link>
          </div>
        )}
      </div>

      {/* Top content brief — the main reason to come back */}
      {insightReady && topBrief ? (
        <div className="dashboard-mirror-card mb-6 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="dashboard-mirror-kicker text-xs">Your top video idea right now</p>
              <h2 className="mt-1 text-lg font-semibold text-[#17332d]">{topBrief.title}</h2>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              Score {topBrief.estimatedScore}/100
            </span>
          </div>
          {topBrief.reasoning && (
            <p className="mb-4 text-sm text-[#17332d]/70">{topBrief.reasoning}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            {topBrief.hookIdeas.length > 0 && (
              <div>
                <p className="dashboard-mirror-kicker mb-2 text-xs">Hook ideas</p>
                <ul className="space-y-1">
                  {topBrief.hookIdeas.slice(0, 2).map((h, i) => (
                    <li key={i} className="text-xs text-[#17332d]/76">• {h}</li>
                  ))}
                </ul>
              </div>
            )}
            {topBrief.contentOutline.length > 0 && (
              <div>
                <p className="dashboard-mirror-kicker mb-2 text-xs">Outline</p>
                <ol className="space-y-1">
                  {topBrief.contentOutline.slice(0, 3).map((s, i) => (
                    <li key={i} className="text-xs text-[#17332d]/76">{i + 1}. {s}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          {stalenessNote.show && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                <path d="M8 5.5v3" />
                <path d="M8 10.5v.5" />
              </svg>
              <p className="text-xs text-amber-700">{stalenessNote.message}</p>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            <Link href="/dashboard/insights" className="btn-primary text-sm">
              See all 4 video ideas
            </Link>
            <Link href="/dashboard/insights" className="dashboard-mirror-subtle text-xs hover:text-[#17332d]">
              Re-analyze channel →
            </Link>
          </div>
        </div>
      ) : insightRunning ? (
        <div className="dashboard-mirror-card mb-6 p-6">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            <p className="text-sm font-medium text-[#17332d]">Analysis running — your content briefs will appear here shortly.</p>
          </div>
        </div>
      ) : totalVlogs > 0 ? (
        <div className="dashboard-mirror-card mb-6 p-6">
          <p className="dashboard-mirror-kicker text-xs">Growth Intelligence</p>
          <h2 className="mt-1 mb-1 text-base font-semibold text-[#17332d]">
            Find out why your best videos work — and what to film next
          </h2>
          <p className="dashboard-mirror-subtle mb-4 text-sm">
            AI analyzes your {totalVlogs} video{totalVlogs !== 1 ? 's' : ''}, mines audience comments, and generates
            {' '}4 personalized content briefs ranked by predicted performance.
          </p>
          <Link href="/dashboard/insights" className="btn-primary text-sm">
            Run channel analysis
          </Link>
        </div>
      ) : creator.youtubeChannelId ? (
        <div className="dashboard-mirror-card mb-6 p-6">
          <p className="dashboard-mirror-kicker text-xs">First step</p>
          <h2 className="mt-1 mb-1 text-base font-semibold text-[#17332d]">Import your YouTube videos</h2>
          <p className="dashboard-mirror-subtle mb-4 text-sm">
            Pull in your catalog to unlock content analysis, audience demand signals, and personalized video ideas.
          </p>
          <Link href="/dashboard/vlogs" className="btn-primary text-sm">
            Import videos
          </Link>
        </div>
      ) : null}

      {/* Content gaps — quick signal if insights exist */}
      {insightReady && (patterns.content_gaps ?? []).length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="dashboard-mirror-card p-5">
            <p className="dashboard-mirror-kicker mb-3 text-xs">What's working for you</p>
            <ul className="space-y-2">
              {(patterns.top_patterns ?? []).slice(0, 3).map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#17332d]/76">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="dashboard-mirror-card p-5">
            <p className="dashboard-mirror-kicker mb-3 text-xs">Untapped opportunities</p>
            <ul className="space-y-2">
              {(patterns.content_gaps ?? []).slice(0, 3).map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#17332d]/76">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Recent videos */}
      {recentVlogs.length > 0 && (
        <div className="dashboard-mirror-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[rgba(214,205,184,0.08)] p-5">
            <h2 className="font-semibold text-[#17332d]">Your videos</h2>
            <Link href="/dashboard/vlogs" className="dashboard-mirror-subtle text-xs hover:text-[#17332d]">
              View all {totalVlogs} →
            </Link>
          </div>
          <div className="divide-y divide-[rgba(214,205,184,0.08)]">
            {recentVlogs.map((vlog) => (
              <div key={vlog.id} className="flex items-center gap-4 px-5 py-3">
                {vlog.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vlog.thumbnailUrl}
                    alt=""
                    className="h-10 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-16 shrink-0 rounded bg-[#17332d]/8" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#17332d]">{vlog.title}</p>
                  <p className="dashboard-mirror-muted mt-0.5 text-xs">
                    {vlog.publishedAt ? new Date(vlog.publishedAt).toLocaleDateString() : 'No date'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-5 text-right">
                  <div>
                    <p className="text-sm font-semibold text-[#17332d]">
                      {(vlog.viewCount ?? 0).toLocaleString()}
                    </p>
                    <p className="dashboard-mirror-muted text-xs">views</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#17332d]">
                      {(vlog.likeCount ?? 0).toLocaleString()}
                    </p>
                    <p className="dashboard-mirror-muted text-xs">likes</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
