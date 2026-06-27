import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import {
  getCreatorPlanConfig,
  resolveAutoImportCount,
  selectVlogIdsForAutoTranscription,
} from '@/lib/creatorPlans'
import { recordApiObservation } from '@/lib/observability'
import {
  fetchYouTubeCatalog,
  getYouTubeAccessToken,
  isYouTubeReconnectRequiredError,
} from '@/lib/youtubeCatalog'

// Give the scan enough time to finish on Vercel (YouTube API + Prisma upserts)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/creator/scan', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Scans are expensive — limit to 5 per minute per user
  if (rateLimit(user.id, 'scan:trigger', { limit: 5, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const requestedVideoIds = Array.isArray(body.videoIds)
    ? body.videoIds.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
    : null

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
  }
  if (!creator.youtubeChannelId) {
    record(400, 'youtube_not_connected')
    return NextResponse.json({ error: 'Connect a YouTube channel first' }, { status: 400 })
  }

  await prisma.creator.update({
    where: { id: creator.id },
    data: { catalogScanStatus: 'SCANNING' },
  })

  if (requestedVideoIds?.length) {
    try {
      const result = await runScan(creator.id, creator.youtubeChannelId, creator.plan, requestedVideoIds)
      record(200, 'selected_import_complete')
      return NextResponse.json({
        status: 'COMPLETE',
        importedCount: result.importedCount,
        limitReached: result.limitReached,
      })
    } catch (e) {
      console.error('Selected import failed:', e)
      await prisma.creator.update({
        where: { id: creator.id },
        data: { catalogScanStatus: 'FAILED' },
      })
      if (isYouTubeReconnectRequiredError(e)) {
        record(409, 'youtube_reconnect_required')
        return NextResponse.json(
          {
            error: 'Reconnect your YouTube channel to continue importing videos.',
            reconnectRequired: true,
          },
          { status: 409 },
        )
      }
      record(500, 'selected_import_failed')
      return NextResponse.json({ error: 'Could not import those videos right now.' }, { status: 500 })
    }
  }

  try {
    await getYouTubeAccessToken(creator.id)
  } catch (error) {
    await prisma.creator.update({
      where: { id: creator.id },
      data: { catalogScanStatus: 'FAILED' },
    })
    if (isYouTubeReconnectRequiredError(error)) {
      record(409, 'youtube_reconnect_required')
      return NextResponse.json(
        {
          error: 'Reconnect your YouTube channel to continue scanning.',
          reconnectRequired: true,
        },
        { status: 409 },
      )
    }
    record(500, 'token_refresh_failed')
    return NextResponse.json({ error: 'Could not access your YouTube channel right now.' }, { status: 500 })
  }

  try {
    const result = await runScan(creator.id, creator.youtubeChannelId, creator.plan, null)
    // First-run: once a creator's catalogue is imported, kick off channel
    // analysis automatically so they land on real insights instead of an empty
    // page. Best-effort and only on the very first analysis.
    let analysisQueued = false
    if (result.importedCount > 0) {
      analysisQueued = await maybeTriggerFirstAnalysis(supabase, creator.id)
    }
    record(200, 'scan_complete')
    return NextResponse.json({
      status: 'COMPLETE',
      importedCount: result.importedCount,
      limitReached: result.limitReached,
      analysisQueued,
    })
  } catch (e) {
    console.error('Scan failed:', e)
    await prisma.creator.update({
      where: { id: creator.id },
      data: { catalogScanStatus: 'FAILED' },
    })
    if (isYouTubeReconnectRequiredError(e)) {
      record(409, 'youtube_reconnect_required')
      return NextResponse.json(
        {
          error: 'Reconnect your YouTube channel to continue scanning.',
          reconnectRequired: true,
        },
        { status: 409 },
      )
    }
    record(500, 'scan_failed')
    return NextResponse.json({ error: 'Could not scan your channel right now.' }, { status: 500 })
  }
}

type SupabaseLike = {
  auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> }
}

// Trigger channel analysis once, on the creator's first import. No-op if they've
// already been analyzed, the AI pipeline isn't configured, or there's no session.
// Best-effort: never throws, so a failure here can't fail the scan.
async function maybeTriggerFirstAnalysis(supabase: SupabaseLike, creatorId: string): Promise<boolean> {
  try {
    const existing = await prisma.channelInsight.findUnique({
      where: { creatorId },
      select: { id: true },
    })
    if (existing) return false

    const aiUrl = process.env.AI_PIPELINE_URL
    if (!aiUrl) return false

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return false

    const res = await fetch(`${aiUrl}/api/v1/insights/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

async function runScan(creatorId: string, channelId: string, plan: string, selectedVideoIds?: string[] | null) {
  const { maxImportedVlogs } = getCreatorPlanConfig(plan)
  const accessToken = await getYouTubeAccessToken(creatorId)
  const catalog = await fetchYouTubeCatalog(channelId, accessToken)
  const selectedSet = selectedVideoIds?.length ? new Set(selectedVideoIds) : null
  const existingVlogs = await prisma.vlog.findMany({
    where: { creatorId },
    select: { externalId: true },
  })
  const importedExternalIds = new Set(existingVlogs.map((vlog) => vlog.externalId))
  let limitReached = false

  // Selected import: exactly the videos the creator picked.
  // Default (automatic) import: the most-recent N (recency-ordered), so a brand
  // new creator gets meaningful niche/style/performance signal without us
  // ingesting their entire back-catalogue. Bounded by the plan's import cap.
  let videosToConsider: typeof catalog
  if (selectedSet) {
    videosToConsider = catalog.filter((item) => selectedSet.has(item.videoId))
  } else {
    const byRecencyDesc = (a: typeof catalog[number], b: typeof catalog[number]) =>
      (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0)
    videosToConsider = [...catalog].sort(byRecencyDesc).slice(0, resolveAutoImportCount(plan))
  }

  // Auto-transcribe policy: on a default import, optionally queue the top-N most
  // viewed for transcription so the first analysis has voice/style signal.
  // Disabled by default (AUTO_TRANSCRIBE_TOP_N = 0) since transcription is credit-gated.
  const autoTranscribeIds = selectedSet
    ? new Set<string>()
    : new Set(selectVlogIdsForAutoTranscription(videosToConsider))

  let importedCount = 0

  for (const item of videosToConsider) {
    const isExisting = importedExternalIds.has(item.videoId)
    if (!isExisting && importedExternalIds.size >= maxImportedVlogs) {
      limitReached = true
      break
    }

    await prisma.vlog.upsert({
      where: { platform_externalId: { platform: 'YOUTUBE', externalId: item.videoId } },
      create: {
        creatorId,
        platform: 'YOUTUBE',
        externalId: item.videoId,
        externalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnailUrl,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        durationSeconds: item.durationSeconds,
        viewCount: item.viewCount ?? 0,
        likeCount: item.likeCount ?? 0,
        processingStatus: autoTranscribeIds.has(item.videoId) ? 'QUEUED' : 'PENDING',
      },
      update: {
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnailUrl,
        durationSeconds: item.durationSeconds,
        viewCount: item.viewCount ?? 0,
        likeCount: item.likeCount ?? 0,
      },
    })

    if (!isExisting) {
      importedExternalIds.add(item.videoId)
      importedCount += 1
    }
  }

  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      catalogScanStatus: 'COMPLETE',
      lastCatalogScan: new Date(),
    },
  })

  return { importedCount, limitReached }
}
