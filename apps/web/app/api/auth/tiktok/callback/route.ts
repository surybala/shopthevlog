import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code        = searchParams.get('code')
  const stateUserId = searchParams.get('state')
  const error       = searchParams.get('error')

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=${reason}`)

  if (error || !code || !stateUserId) return fail('tiktok_denied')

  // CSRF: verify state matches the authenticated session
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== stateUserId) return fail('tiktok_denied')

  // PKCE: retrieve verifier stored during initiation
  const codeVerifier = req.cookies.get('tiktok_pkce_verifier')?.value
  if (!codeVerifier) return fail('tiktok_pkce_missing')

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key:    process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  process.env.TIKTOK_REDIRECT_URI!,
        code_verifier: codeVerifier,
      }),
    })

    if (!tokenRes.ok) {
      console.error('[TikTok] token exchange failed:', tokenRes.status, await tokenRes.text())
      return fail('tiktok_token_failed')
    }

    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      console.error('[TikTok] no access_token:', tokens)
      return fail('tiktok_token_failed')
    }

    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const userData   = await userRes.json()
    const tiktokUser = userData.data?.user

    const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
    if (!creator) return fail('tiktok_no_creator')

    const tokenExpiry = new Date(Date.now() + (tokens.expires_in ?? 86400) * 1000)
    const channelId   = tiktokUser?.open_id ?? tokens.open_id ?? ''

    await prisma.creatorChannelToken.upsert({
      where:  { creatorId_platform: { creatorId: creator.id, platform: 'TIKTOK' } },
      create: {
        creatorId:    creator.id,
        platform:     'TIKTOK',
        channelId,
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        tokenExpiry,
        scopes:       ['user.info.basic', 'video.list'],
      },
      update: {
        accessToken:  tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        tokenExpiry,
        channelId,
      },
    })

    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        tiktokUserId: tiktokUser?.open_id ?? tokens.open_id ?? null,
        tiktokHandle: tiktokUser?.username ?? null,
      },
    })

    const response = NextResponse.redirect(
      `${origin}/dashboard/settings?tab=channels&connected=tiktok`
    )
    response.cookies.set('tiktok_pkce_verifier', '', { maxAge: 0, path: '/' })
    return response

  } catch (e) {
    console.error('[TikTok] OAuth error:', e)
    return fail('tiktok_failed')
  }
}
