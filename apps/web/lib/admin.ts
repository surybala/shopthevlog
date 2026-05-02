/**
 * Admin guard — server-side only.
 *
 * Configure via the ADMIN_EMAILS environment variable:
 *   ADMIN_EMAILS=cherry@vlogshopper.com,surya@vlogshopper.com
 *
 * Falls back to ADMIN_EMAIL (the single-address email notification setting)
 * so you only need one env var for simple setups.
 */
export function isAdmin(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? ''
  if (!raw.trim()) return false // no admins configured — deny by default

  const normalised = email.trim().toLowerCase()
  return raw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalised)
}

type AdminLikeUser = {
  email?: string | null
  app_metadata?: {
    admin?: boolean
    is_admin?: boolean
    role?: string
  } | null
} | null | undefined

export function hasAdminMetadata(user: AdminLikeUser): boolean {
  if (!user?.app_metadata) return false

  return (
    user.app_metadata.admin === true ||
    user.app_metadata.is_admin === true ||
    user.app_metadata.role === 'admin'
  )
}

export function isAdminUser(user: AdminLikeUser): boolean {
  if (!user) return false
  return hasAdminMetadata(user) || (!!user.email && isAdmin(user.email))
}

/**
 * Server-side admin guard for Next.js App Router route handlers.
 *
 * Returns the authenticated user if they are an admin, or a NextResponse with
 * the appropriate 401/403 error that the caller should return immediately.
 *
 * Usage:
 *   const result = await requireAdmin()
 *   if (result instanceof NextResponse) return result
 *   const user = result  // fully typed User
 */
export async function requireAdmin() {
  // Import here to avoid pulling Next.js server-only modules into shared code
  const { NextResponse } = await import('next/server')
  const { createSupabaseServer } = await import('@/lib/supabase/server')

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}
