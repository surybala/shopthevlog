import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const userId = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !userId) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=tiktok_denied`)
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI!,
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) throw new Error('No access token')

    // Fetch user info
    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const userData = await userRes.json()
    const tiktokUser = userData.data?.user

    const creator = await prisma.creator.findUnique({ where: { userId } })
    if (!creator) throw new Error('Creator not found')

    const tokenExpiry = new Date(Date.now() + (tokens.expires_in ?? 86400) * 1000)

    await prisma.creatorChannelToken.upsert({
      where: { creatorId_platform: { creatorId: creator.id, platform: 'TIKTOK' } },
      create: {
        creatorId: creator.id,
        platform: 'TIKTOK',
        channelId: tiktokUser?.open_id ?? tokens.open_id ?? '',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        tokenExpiry,
        scopes: ['user.info.basic', 'video.list'],
      },
      update: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        tokenExpiry,
        channelId: tiktokUser?.open_id ?? tokens.open_id ?? '',
      },
    })

    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        tiktokUserId: tiktokUser?.open_id ?? tokens.open_id ?? null,
        tiktokHandle: tiktokUser?.username ?? null,
      },
    })

    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&connected=tiktok`)
  } catch (e) {
    console.error('TikTok OAuth error:', e)
    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=tiktok_failed`)
  }
}
