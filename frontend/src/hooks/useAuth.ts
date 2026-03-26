import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import type { Profile } from '../types/user'

export function useAuth() {
  const { session, profile, loading, setSession, setProfile, setLoading, clear } = useAuthStore()

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session
    // (including INITIAL_SESSION event) — this is the reliable way to
    // get the session because getSession() can race with storage restore.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session) {
        // Unblock the UI immediately — profile loads in the background.
        setLoading(false)
        fetchProfile()
      } else {
        // No session — stop loading so AuthGuard can redirect to /login
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          clear()
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile() {
    try {
      const { data } = await api.get<Profile>('/auth/me')
      setProfile(data)
    } catch {
      // Profile row may not exist yet for brand-new OAuth users —
      // the Supabase webhook creates it asynchronously
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    clear()
  }

  return { session, profile, loading, signOut }
}
