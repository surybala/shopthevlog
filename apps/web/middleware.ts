import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  // ── Supabase session refresh ─────────────────────────────────────────────
  // Must run on every request. Without this the JWT expires and server
  // components see no user — causing the "sign in again" loop.
  let response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write refreshed tokens to both request (so server components see
          // them) and response (so the browser receives updated cookies).
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          response = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired — do NOT remove this line
  await supabase.auth.getUser()
  // ─────────────────────────────────────────────────────────────────────────

  // ── Storefront rewrite: /@handle/* → /store/[handle]/* ──────────────────
  const pathname = req.nextUrl.pathname
  const match = pathname.match(/^\/@([^/]+)(\/.*)?$/)
  if (match) {
    const handle = match[1]
    const rest   = match[2] ?? ''
    const url    = req.nextUrl.clone()
    url.pathname = `/store/${handle}${rest}`
    // Copy session cookies onto the rewrite response so they aren't lost
    const rewrite = NextResponse.rewrite(url, { request: req })
    response.cookies.getAll().forEach(c => rewrite.cookies.set(c.name, c.value))
    return rewrite
  }
  // ─────────────────────────────────────────────────────────────────────────

  return response
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon|logo|api/).*)',
  ],
}
