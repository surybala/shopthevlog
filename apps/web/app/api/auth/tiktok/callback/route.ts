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

  // CSRF / state validation
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== stateUserId) return fail('tiktok_denied')

  // PKCE: read verifier from the incoming request cookies
  const codeVerifier = req.cookies.get('tiktok_pkce_verifier')?.value
  if (!codeVerifier) {
    console.error('[TikTok PKCE] verifier cookie missing — cookies:', req.cookies.getAll().map(c => c.name))
    return fail('tiktok_pkce_missing')
  }

  console.log('[TikTok PKCE] verifier in callback (len=' + codeVerifier.length + '):', codeVerifier.slice(0, 8) + '…')

  try {
    // Debug: send client_secret but NO code_verifier to test whether TikTok
    // sandbox validates PKCE in the token exchange at all.
    const tokenBody = new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  process.env.TIKTOK_REDIRECT_URI!,
      // code_verifier intentionally omitted — debug only
    })

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: tokenBody,
    })

    const responseText = await tokenRes.text()
    console.log('[TikTok] token response status:', tokenRes.status)
    console.log('[TikTok] token response body:', responseText)

    if (!tokenRes.ok) return fail('tiktok_token_failed')

    const tokens = JSON.parse(responseText)
    if (!tokens.access_token) return fail('tiktok_token_failed')

    // Fetch TikTok user profile
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
