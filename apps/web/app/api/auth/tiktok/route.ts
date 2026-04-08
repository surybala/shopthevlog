import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * PKCE code_verifier — RFC 7636 §4.1
 * Must use only unreserved URI chars: [A-Z a-z 0-9 - . _ ~], length 43–128.
 * We use base64url (subset of unreserved chars) from 32 random bytes = 43 chars.
 */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url') // 32 bytes → 43 base64url chars
}

/**
 * PKCE code_challenge — RFC 7636 §4.2
 * BASE64URL(SHA256(ASCII(code_verifier))) — no padding.
 * We manually convert base64 → base64url to avoid Node.js version quirks
 * with Hash.digest('base64url').
 */
function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest('base64')
  // Convert standard base64 → base64url (RFC 4648 §5)
  return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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

  // Debug: log first 8 chars of each so we can verify they match in callback
  console.log('[TikTok PKCE] verifier[:8]  =', codeVerifier.slice(0, 8))
  console.log('[TikTok PKCE] challenge[:8] =', codeChallenge.slice(0, 8))

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })

  // Cookie must be set on the response object — next/headers cookies().set()
  // does NOT attach Set-Cookie headers to redirect responses.
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
