import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * PKCE code_verifier — RFC 7636 §4.1
 * Alphanumeric only (safe subset of unreserved chars), 64 chars.
 */
function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(64)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

/**
 * TikTok PKCE code_challenge.
 *
 * Despite RFC 7636 requiring BASE64URL (no padding, - and _ substitutions),
 * TikTok's server verifies by computing SHA256(verifier) → STANDARD BASE64
 * and comparing against the stored challenge. Sending base64url (_) causes a
 * mismatch against their computed base64 (/). We therefore send standard
 * base64 WITH padding; URLSearchParams will percent-encode + / = in the URL.
 */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64')
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

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge, // standard base64; + / = will be %-encoded
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
