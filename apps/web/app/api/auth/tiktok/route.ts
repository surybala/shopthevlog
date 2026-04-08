import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * PKCE code_verifier — RFC 7636 §4.1
 * Alphanumeric only, 64 chars (within the 43–128 limit).
 */
function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(64)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return NextResponse.json({ error: 'TikTok OAuth not configured' }, { status: 500 })
  }

  // TikTok sandbox appears to validate PKCE as plain (verifier == challenge)
  // regardless of code_challenge_method. Using plain here to confirm; if this
  // works we know sandbox is broken for S256 but production will enforce it.
  const codeVerifier = generateCodeVerifier()

  console.log('[TikTok PKCE] verifier (plain test) =', codeVerifier.slice(0, 12) + '…')

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeVerifier,  // plain: challenge = verifier
    code_challenge_method: 'plain',
  })

  const response = NextResponse.redirect(
    `https://www.tiktok.com/v2/auth/authorize/?${params}`
  )
  response.cookies.set('tiktok_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   600,
    path:     '/',
  })

  return response
}
