import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const userId = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !userId) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=youtube_denied`)
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.YOUTUBE_CLIENT_ID!,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
        redirect_uri: process.env.YOUTUBE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) throw new Error('No access token returned')

    // Fetch YouTube channel info
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const channelData = await channelRes.json()
    const channel = channelData.items?.[0]
    if (!channel) throw new Error('No YouTube channel found')

    const channelId = channel.id as string
    const channelHandle = (channel.snippet?.customUrl as string | undefined)?.replace('@', '') ?? channel.snippet?.title

    // Get creator
    const creator = await prisma.creator.findUnique({ where: { userId } })
    if (!creator) throw new Error('Creator not found')

    const tokenExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000)

    // Upsert token
    await prisma.creatorChannelToken.upsert({
      where: { creatorId_platform: { creatorId: creator.id, platform: 'YOUTUBE' } },
      create: {
        creatorId: creator.id,
        platform: 'YOUTUBE',
        channelId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        tokenExpiry,
        scopes: ['youtube.readonly'],
      },
      update: {
        channelId,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        tokenExpiry,
      },
    })

    // Update creator
    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        youtubeChannelId: channelId,
        youtubeHandle: channelHandle ?? null,
      },
    })

    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&connected=youtube`)
  } catch (e) {
    console.error('YouTube OAuth error:', e)
    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=youtube_failed`)
  }
}
