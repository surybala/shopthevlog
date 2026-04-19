import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import { buildCatalogVideoInsight } from '@/lib/vlogInsights'
import {
  fetchYouTubeCatalog,
  getYouTubeAccessToken,
  isYouTubeReconnectRequiredError,
} from '@/lib/youtubeCatalog'

function extractYouTubeVideoId(rawUrl: string) {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '') || null
    }

    if (url.hostname.includes('youtube.com')) {
      const watchId = url.searchParams.get('v')
      if (watchId) return watchId

      const segments = url.pathname.split('/').filter(Boolean)
      const embedIndex = segments.findIndex((segment) => segment === 'embed' || segment === 'shorts')
      if (embedIndex >= 0 && segments[embedIndex + 1]) return segments[embedIndex + 1]
    }
  } catch {
    return null
  }

  return null
}

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true, youtubeChannelId: true, plan: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
  if (!creator.youtubeChannelId) {
    return NextResponse.json({ error: 'Connect a YouTube channel first' }, { status: 400 })
  }

  let accessToken: string
  try {
    accessToken = await getYouTubeAccessToken(creator.id)
  } catch (error) {
    if (isYouTubeReconnectRequiredError(error)) {
      return NextResponse.json(
        { error: 'Reconnect your YouTube channel to load your catalog.', reconnectRequired: true },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Could not access YouTube right now.' }, { status: 500 })
  }
  const catalog = await fetchYouTubeCatalog(creator.youtubeChannelId, accessToken)
  const existingVlogs = await prisma.vlog.findMany({
    where: { creatorId: creator.id },
    select: { externalId: true, id: true, processingStatus: true },
  })
  const importedByExternalId = new Map(existingVlogs.map((vlog) => [vlog.externalId, vlog]))
  const { maxImportedVlogs } = getCreatorPlanConfig(creator.plan)
  const query = req.nextUrl.searchParams.get('query')?.trim().toLowerCase() ?? ''
  const showImported = req.nextUrl.searchParams.get('showImported') === 'true'

  const filteredCatalog = catalog.filter((item) => {
    const imported = importedByExternalId.get(item.videoId)
    if (!showImported && imported) return false
    if (!query) return true
    return item.title.toLowerCase().includes(query) || (item.description ?? '').toLowerCase().includes(query)
  }).sort((left, right) => {
    const leftInsight = buildCatalogVideoInsight(left)
    const rightInsight = buildCatalogVideoInsight(right)
    if (leftInsight.score !== rightInsight.score) return rightInsight.score - leftInsight.score
    return new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime()
  })

  return NextResponse.json({
    vlogLimit: maxImportedVlogs,
    remainingVlogSlots: Math.max(maxImportedVlogs - existingVlogs.length, 0),
    videos: filteredCatalog.map((item) => {
      const imported = importedByExternalId.get(item.videoId)
      return {
        ...item,
        imported: !!imported,
        importedVlogId: imported?.id ?? null,
        importedProcessingStatus: imported?.processingStatus ?? null,
        insights: buildCatalogVideoInsight(item),
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true, youtubeChannelId: true, plan: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
  if (!creator.youtubeChannelId) {
    return NextResponse.json({ error: 'Connect a YouTube channel first' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : ''
  const videoId = extractYouTubeVideoId(videoUrl)

  if (!videoId) {
    return NextResponse.json({ error: 'Enter a valid YouTube video URL.' }, { status: 400 })
  }

  let accessToken: string
  try {
    accessToken = await getYouTubeAccessToken(creator.id)
  } catch (error) {
    if (isYouTubeReconnectRequiredError(error)) {
      return NextResponse.json(
        { error: 'Reconnect your YouTube channel to search for that video.', reconnectRequired: true },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Could not access YouTube right now.' }, { status: 500 })
  }
  const catalog = await fetchYouTubeCatalog(creator.youtubeChannelId, accessToken)
  const matched = catalog.find((item) => item.videoId === videoId)

  if (!matched) {
    return NextResponse.json({ error: 'That video was not found on your connected YouTube channel.' }, { status: 404 })
  }

  const existing = await prisma.vlog.findUnique({
    where: { platform_externalId: { platform: 'YOUTUBE', externalId: videoId } },
    select: { id: true, creatorId: true },
  })
  const creatorVlogCount = await prisma.vlog.count({ where: { creatorId: creator.id } })
  const { maxImportedVlogs } = getCreatorPlanConfig(creator.plan)

  if (!existing && creatorVlogCount >= maxImportedVlogs) {
    return NextResponse.json({ error: 'You have reached your video import limit for this plan.' }, { status: 409 })
  }

  return NextResponse.json({
    vlogLimit: maxImportedVlogs,
    remainingVlogSlots: Math.max(maxImportedVlogs - creatorVlogCount, 0),
    video: {
      ...matched,
      imported: !!existing && existing.creatorId === creator.id,
      importedVlogId: existing?.creatorId === creator.id ? existing.id : null,
      insights: buildCatalogVideoInsight(matched),
    },
  })
}
