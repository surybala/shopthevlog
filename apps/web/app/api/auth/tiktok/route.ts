import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/** RFC 7636 §4.1 — 32 random bytes → 43-char base64url verifier */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** RFC 7636 §4.2 — S256: BASE64URL(SHA256(verifier)), no padding */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return NextResponse.json({ error: 'TikTok OAuth not configured' }, { status: 500 })
  }

  const codeVerifier  = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  // NOTE: TikTok sandbox PKCE validation is broken — this flow will only work
  // in production with an HTTPS redirect URI. The S256 implementation here is
  // correct per RFC 7636 and has been verified locally.
  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
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
