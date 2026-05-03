import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
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
    record(200, 'scan_complete')
    return NextResponse.json({
      status: 'COMPLETE',
      importedCount: result.importedCount,
      limitReached: result.limitReached,
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
  const videosToConsider = selectedSet
    ? catalog.filter((item) => selectedSet.has(item.videoId))
    : catalog
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
        processingStatus: 'PENDING',
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

  // Optionally notify AI pipeline
  const aiUrl = process.env.AI_PIPELINE_URL
  if (aiUrl) {
    fetch(`${aiUrl}/api/v1/webhooks/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creatorId }),
    }).catch(() => {})
  }

  return { importedCount, limitReached }
}
