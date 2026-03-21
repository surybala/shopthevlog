import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import type { Profile } from '../types/user'

export function useAuth() {
  const { session, profile, loading, setSession, setProfile, setLoading, clear } = useAuthStore()

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile()
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile()
      else clear()
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile() {
    try {
      const { data } = await api.get<Profile>('/auth/me')
      setProfile(data)
    } catch {
      // profile may not exist yet for brand-new users
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    clear()
  }

  return { session, profile, loading, signOut }
}
