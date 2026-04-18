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

export function buildE2EUser(userId: string) {
  const isAdmin = /admin/i.test(userId)
  return {
    id: userId,
    email: `e2e+${userId}@vlogshopper.test`,
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
