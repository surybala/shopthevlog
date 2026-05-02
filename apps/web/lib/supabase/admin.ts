import { createClient } from '@supabase/supabase-js'

/**
 * Supabase admin client — uses the secret key (formerly service_role).
 * NEVER expose this to the browser. Server-side only.
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY)')
  return createClient(url, key, { auth: { persistSession: false } })
}
