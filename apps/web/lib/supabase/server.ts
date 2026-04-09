import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { buildE2EUser, getE2EUserIdFromCookies } from '@/lib/e2eAuth'

export function createSupabaseServer() {
  const cookieStore = cookies()
  const e2eUserId = getE2EUserIdFromCookies(cookieStore)

  if (e2eUserId) {
    const user = buildE2EUser(e2eUserId)
    return {
      auth: {
        getUser: async () => ({
          data: { user },
          error: null,
        }),
        signOut: async () => ({
          error: null,
        }),
      },
    } as const
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll is called from a Server Component — cookies are read-only there.
            // The middleware will handle refreshing the session instead.
          }
        },
      },
    }
  )
}
