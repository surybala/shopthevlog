import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/** RFC 7636 §4.1 — 32 random bytes → 43-char base64url, no padding */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** RFC 7636 §4.2 — S256: BASE64URL(SHA256(verifier)), no padding */
function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return hash.toString('base64url')
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

  console.log('[TikTok PKCE] verifier  =', codeVerifier)
  console.log('[TikTok PKCE] challenge =', codeChallenge)

  // Build URL manually to avoid URLSearchParams encoding the scope comma as
  // %2C — TikTok may misparse a percent-encoded comma and corrupt the stored
  // code_challenge. All other values that need encoding use encodeURIComponent.
  const authUrl =
    'https://www.tiktok.com/v2/auth/authorize/' +
    '?client_key='            + encodeURIComponent(process.env.TIKTOK_CLIENT_KEY) +
    '&response_type=code' +
    '&scope=user.info.basic,video.list' +        // raw comma — not %2C
    '&redirect_uri='          + encodeURIComponent(process.env.TIKTOK_REDIRECT_URI) +
    '&state='                 + encodeURIComponent(user.id) +
    '&code_challenge='        + encodeURIComponent(codeChallenge) +
    '&code_challenge_method=S256'

  console.log('[TikTok] auth URL =', authUrl)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('tiktok_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   600,
    path:     '/',
  })

  return response
}
