import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function refreshYouTubeToken(token: { refreshToken: string; creatorId: string }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token refresh failed')

  const tokenExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000)
  await prisma.creatorChannelToken.update({
    where: { creatorId_platform: { creatorId: token.creatorId, platform: 'YOUTUBE' } },
    data: { accessToken: data.access_token, tokenExpiry },
  })
  return data.access_token as string
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
  if (!creator.youtubeChannelId) {
    return NextResponse.json({ error: 'Connect a YouTube channel first' }, { status: 400 })
  }

  await prisma.creator.update({
    where: { id: creator.id },
    data: { catalogScanStatus: 'SCANNING' },
  })

  // Run in background — don't await
  runScan(creator.id, creator.youtubeChannelId).catch(async (e) => {
    console.error('Scan failed:', e)
    await prisma.creator.update({
      where: { id: creator.id },
      data: { catalogScanStatus: 'FAILED' },
    })
  })

  return NextResponse.json({ status: 'SCANNING' })
}

async function runScan(creatorId: string, channelId: string) {
  // Get stored token
  const tokenRecord = await prisma.creatorChannelToken.findUnique({
    where: { creatorId_platform: { creatorId, platform: 'YOUTUBE' } },
  })
  if (!tokenRecord) throw new Error('No YouTube token found')

  // Refresh if expired
  let accessToken = tokenRecord.accessToken
  if (tokenRecord.tokenExpiry < new Date()) {
    accessToken = await refreshYouTubeToken({ refreshToken: tokenRecord.refreshToken, creatorId })
  }

  // Fetch all videos via uploads playlist
  // First get the uploads playlist ID
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const channelData = await channelRes.json()
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist')

  // Paginate through all videos (max 50 per page)
  let pageToken: string | undefined
  let totalImported = 0

  do {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      ...(pageToken && { pageToken }),
    })
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const playlistData = await playlistRes.json()

    const items = playlistData.items ?? []
    for (const item of items) {
      const videoId = item.contentDetails?.videoId as string
      const snippet = item.snippet
      if (!videoId) continue

      await prisma.vlog.upsert({
        where: { platform_externalId: { platform: 'YOUTUBE', externalId: videoId } },
        create: {
          creatorId,
          platform: 'YOUTUBE',
          externalId: videoId,
          externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          title: snippet?.title ?? 'Untitled',
          description: snippet?.description ?? null,
          thumbnailUrl: snippet?.thumbnails?.high?.url ?? snippet?.thumbnails?.default?.url ?? null,
          publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : null,
          processingStatus: 'PENDING',
        },
        update: {
          title: snippet?.title ?? 'Untitled',
          description: snippet?.description ?? null,
          thumbnailUrl: snippet?.thumbnails?.high?.url ?? snippet?.thumbnails?.default?.url ?? null,
        },
      })
      totalImported++
    }

    pageToken = playlistData.nextPageToken
  } while (pageToken)

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
    fetch(`${aiUrl}/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creatorId }),
    }).catch(() => {})
  }
}
