import prisma from '@/lib/prisma/client'

export async function refreshYouTubeToken(token: { refreshToken: string; creatorId: string }) {
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

export async function getYouTubeAccessToken(creatorId: string) {
  const tokenRecord = await prisma.creatorChannelToken.findUnique({
    where: { creatorId_platform: { creatorId, platform: 'YOUTUBE' } },
  })
  if (!tokenRecord) throw new Error('No YouTube token found')

  if (tokenRecord.tokenExpiry < new Date()) {
    return refreshYouTubeToken({ refreshToken: tokenRecord.refreshToken, creatorId })
  }

  return tokenRecord.accessToken
}

async function getUploadsPlaylistId(channelId: string, accessToken: string) {
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const channelData = await channelRes.json()
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist')
  return uploadsPlaylistId as string
}

export type YouTubeCatalogItem = {
  videoId: string
  title: string
  description: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
}

export async function fetchYouTubeCatalog(channelId: string, accessToken: string) {
  const uploadsPlaylistId = await getUploadsPlaylistId(channelId, accessToken)
  const results: YouTubeCatalogItem[] = []
  let pageToken: string | undefined

  while (true) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      ...(pageToken && { pageToken }),
    })

    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const playlistData = await playlistRes.json()

    const items = playlistData.items ?? []
    for (const item of items) {
      const videoId = item.contentDetails?.videoId as string | undefined
      const snippet = item.snippet
      if (!videoId) continue

      results.push({
        videoId,
        title: snippet?.title ?? 'Untitled',
        description: snippet?.description ?? null,
        thumbnailUrl: snippet?.thumbnails?.high?.url ?? snippet?.thumbnails?.default?.url ?? null,
        publishedAt: snippet?.publishedAt ?? null,
      })
    }

    pageToken = playlistData.nextPageToken
    if (!pageToken) break
  }

  return results
}
