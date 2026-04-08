import { createClient } from '@supabase/supabase-js'

/**
 * Supabase admin client — uses the service role key.
 * NEVER expose this to the browser. Server-side only.
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env vars')
  return createClient(url, key, { auth: { persistSession: false } })
}
