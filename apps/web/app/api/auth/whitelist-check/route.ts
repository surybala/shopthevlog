import { NextRequest, NextResponse } from 'next/server'
import { isWhitelisted } from '@/lib/whitelist'

/**
 * GET /api/auth/whitelist-check?email=...
 *
 * Used by the client-side signup form to check whether an email is allowed
 * before calling supabase.auth.signUp() — gives a friendlier error than
 * letting the user create an account they can't use.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? ''
  return NextResponse.json({ allowed: isWhitelisted(email) })
}
