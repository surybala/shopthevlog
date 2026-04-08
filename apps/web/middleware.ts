import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isWhitelisted } from '@/lib/whitelist'

// Routes that require the user to be on the whitelist.
// Public routes (/, /discover, /@handle/*, /waitlist, /login, /signup) are
// intentionally excluded — anyone can browse storefronts and the landing page.
const PROTECTED_PREFIXES = ['/dashboard', '/account', '/onboarding']

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
  const { data: { user } } = await supabase.auth.getUser()
  // ─────────────────────────────────────────────────────────────────────────

  // ── Whitelist enforcement ────────────────────────────────────────────────
  // If a signed-in user is on a protected route but not on the whitelist,
  // send them to /waitlist regardless of how they authenticated.
  const pathname = req.nextUrl.pathname
  if (user?.email && PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) {
    if (!isWhitelisted(user.email)) {
      const url = req.nextUrl.clone()
      url.pathname = '/waitlist'
      return NextResponse.redirect(url)
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Storefront rewrite: /@handle/* → /store/[handle]/* ──────────────────
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
