import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/** Generate a cryptographically random PKCE code_verifier (43–128 chars, URL-safe). */
function generateCodeVerifier(): string {
  // 96 random bytes → 128 base64url chars (no padding, URL-safe alphabet)
  return crypto.randomBytes(96).toString('base64url')
}

/** Derive code_challenge = BASE64URL(SHA-256(verifier)) — TikTok requires S256. */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return NextResponse.json({ error: 'TikTok OAuth not configured' }, { status: 500 })
  }

  // ── PKCE ─────────────────────────────────────────────────────────────────
  const codeVerifier  = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  // ─────────────────────────────────────────────────────────────────────────

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })

  // ── Set cookie on the response object (not via next/headers cookies()) ───
  // next/headers cookies().set() does not attach Set-Cookie to redirect
  // responses — must use response.cookies.set() instead.
  const response = NextResponse.redirect(
    `https://www.tiktok.com/v2/auth/authorize/?${params}`
  )
  response.cookies.set('tiktok_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   600, // 10 minutes
    path:     '/',
  })

  return response
}
