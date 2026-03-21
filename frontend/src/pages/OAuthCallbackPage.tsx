import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import Spinner from '../components/ui/Spinner'

export default function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.exchangeCodeForSession(window.location.search).then(async ({ data }) => {
      if (!data.session) { navigate('/login'); return }
      try {
        const { data: profile } = await api.get('/auth/me')
        navigate(profile?.onboarded ? '/feed' : '/onboarding')
      } catch {
        navigate('/onboarding')
      }
    })
  }, [navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <Spinner size="lg" />
      <p className="text-white/60">Signing you in…</p>
    </div>
  )
}
