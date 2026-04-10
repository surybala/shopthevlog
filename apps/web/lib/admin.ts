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
