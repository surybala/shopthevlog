export const E2E_AUTH_COOKIE = 'vs_e2e_user_id'

type CookieReader = {
  get(name: string): { value: string } | undefined
}

export function isE2EAuthEnabled() {
  return process.env.ENABLE_E2E_AUTH === 'true'
}

export function getE2EUserIdFromCookies(cookieStore: CookieReader) {
  if (!isE2EAuthEnabled()) return null

  const raw = cookieStore.get(E2E_AUTH_COOKIE)?.value?.trim()
  return raw ? raw : null
}

// Explicit set of E2E user IDs that receive admin privileges.
// A regex match like /admin/i is intentionally avoided — an attacker who sets
// ENABLE_E2E_AUTH=true in a misconfigured environment must not be able to
// self-grant admin rights by choosing an arbitrary user ID.
function getE2EAdminUserIds() {
  return new Set(
    (process.env.E2E_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function buildE2EUser(userId: string) {
  const isAdmin = getE2EAdminUserIds().has(userId)
  return {
    id: userId,
    email: `e2e+${userId}@tripkits.test`,
    app_metadata: {
      approved: true,
      admin: isAdmin,
      is_admin: isAdmin,
      role: isAdmin ? 'admin' : undefined,
      provider: 'e2e',
    },
    user_metadata: {
      full_name: isAdmin ? 'E2E Admin' : 'E2E Creator',
    },
  }
}

export function getE2EAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
  }
}
