'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [accountType, setAccountType] = useState<'creator' | 'subscriber'>('creator')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createSupabaseClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: name,
          account_type: accountType,
          handle: accountType === 'creator' ? handle : undefined,
        },
      },
    })

    if (signupError) { setError(signupError.message); setLoading(false); return }
    if (data.user) {
      router.push(accountType === 'creator' ? '/dashboard' : '/discover')
    }
  }

  async function handleGoogleSignup() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        queryParams: { account_type: accountType },
      },
    })
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-white">VlogShopper</Link>
          <p className="text-white/40 mt-2 text-sm">Create your free account</p>
        </div>

        <div className="glass-card p-8 space-y-4">
          {/* Account type selector */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl">
            {(['creator', 'subscriber'] as const).map(type => (
              <button
                key={type}
                onClick={() => setAccountType(type)}
                className={`py-2 rounded-lg text-sm font-medium transition-all ${
                  accountType === type ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                }`}
              >
                {type === 'creator' ? '🎬 Creator' : '✈️ Traveler'}
              </button>
            ))}
          </div>

          <button
            onClick={handleGoogleSignup}
            className="w-full flex items-center justify-center gap-3 border border-white/20 rounded-xl py-3 text-sm text-white/80 hover:border-white/40 hover:text-white transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-black px-3 text-white/30">or</span></div>
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <input
              type="text"
              placeholder="Display name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            {accountType === 'creator' && (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm">@</span>
                <input
                  type="text"
                  placeholder="your-handle"
                  value={handle}
                  onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required={accountType === 'creator'}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={8}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-sm disabled:opacity-50">
              {loading ? 'Creating account…' : accountType === 'creator' ? 'Create my storefront →' : 'Start exploring →'}
            </button>
          </form>

          <p className="text-center text-white/40 text-xs">
            Already have an account?{' '}
            <Link href="/(auth)/login" className="text-white hover:underline">Sign in</Link>
          </p>

          <p className="text-center text-white/20 text-[10px]">
            By continuing you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  )
}
