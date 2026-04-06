import { NextRequest, NextResponse } from 'next/server'

/**
 * Rewrite /@handle/* routes to /_store/handle/* so Next.js App Router can
 * serve them from app/_store/[handle]/ — Next.js doesn't support route
 * segments that literally start with "@".
 */
export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Match /@anything (at least one char after @, not a special path)
  const match = pathname.match(/^\/@([^/]+)(\/.*)?$/)
  if (match) {
    const handle = match[1]
    const rest = match[2] ?? ''
    const url = req.nextUrl.clone()
    url.pathname = `/_store/${handle}${rest}`
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  // Run on all paths except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
