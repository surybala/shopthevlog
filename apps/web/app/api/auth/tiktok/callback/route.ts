import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code        = searchParams.get('code')
  const stateUserId = searchParams.get('state')
  const error       = searchParams.get('error')

  const SETTINGS_ERROR = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&error=${reason}`)

  if (error || !code || !stateUserId) {
    return SETTINGS_ERROR('tiktok_denied')
  }

  // ── CSRF / state validation ──────────────────────────────────────────────
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== stateUserId) {
    return SETTINGS_ERROR('tiktok_denied')
  }

  // ── PKCE: retrieve verifier stored during initiation ────────────────────
  const cookieStore = cookies()
  const codeVerifier = cookieStore.get('tiktok_pkce_verifier')?.value
  if (!codeVerifier) {
    // Verifier missing — session expired or cookie blocked
    return SETTINGS_ERROR('tiktok_pkce_missing')
  }
  // Clear it immediately — single-use
  cookieStore.delete('tiktok_pkce_verifier')
  // ────────────────────────────────────────────────────────────────────────

  try {
    // Exchange authorization code for tokens (include code_verifier for PKCE)
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
        code_verifier: codeVerifier,  // ← required when PKCE was used
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('TikTok token exchange failed:', tokenRes.status, body)
      return SETTINGS_ERROR('tiktok_token_failed')
    }

    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      console.error('TikTok token exchange — no access_token:', tokens)
      return SETTINGS_ERROR('tiktok_token_failed')
    }

    // Fetch TikTok user profile
    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const userData = await userRes.json()
    const tiktokUser = userData.data?.user

    // Upsert channel token
    const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
    if (!creator) return SETTINGS_ERROR('tiktok_no_creator')

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

    return NextResponse.redirect(`${origin}/dashboard/settings?tab=channels&connected=tiktok`)
  } catch (e) {
    console.error('TikTok OAuth error:', e)
    return SETTINGS_ERROR('tiktok_failed')
  }
}
