import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'

/** Generate a cryptographically random PKCE code_verifier (43–128 chars, URL-safe). */
function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').slice(0, 128)
}

/** Derive code_challenge = BASE64URL(SHA-256(verifier)) — TikTok requires S256. */
async function generateCodeChallenge(verifier: string): Promise<string> {
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

  // ── PKCE ─────────────────────────────────────────────────────────────────
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  // ─────────────────────────────────────────────────────────────────────────

  // Store verifier in a short-lived httpOnly cookie for use in the callback
  const cookieStore = cookies()
  cookieStore.set('tiktok_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — plenty of time to complete OAuth
    path: '/',
  })

  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    response_type:         'code',
    scope:                 'user.info.basic,video.list',
    redirect_uri:          process.env.TIKTOK_REDIRECT_URI,
    state:                 user.id,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })

  return NextResponse.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params}`)
}
