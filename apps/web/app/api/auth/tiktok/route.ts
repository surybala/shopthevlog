import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * PKCE code_verifier — RFC 7636 §4.1
 * Alphanumeric only (subset of unreserved chars) to avoid any platform-specific
 * handling of - and _ in TikTok's PKCE validation.
 */
function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(64)
  // Map each random byte to a char — 64 chars, well within 43–128 limit
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

/**
 * PKCE code_challenge — RFC 7636 §4.2
 * BASE64URL(SHA256(ASCII(code_verifier))) with no padding.
 * Uses Web Crypto (crypto.subtle) for maximum standards compliance.
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data   = Buffer.from(verifier, 'ascii')
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return NextResponse.json({ error: 'TikTok OAuth not configured' }, { status: 500 })
  }

  const codeVerifier  = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Full values in logs — remove once working
  console.log('[TikTok PKCE] verifier  =', codeVerifier)
  console.log('[TikTok PKCE] challenge =', codeChallenge)

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params}`
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
