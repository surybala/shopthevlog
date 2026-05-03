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
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const supabase = createSupabaseClient()

  async function checkWhitelist(emailToCheck: string): Promise<boolean> {
    const res = await fetch(`/api/auth/whitelist-check?email=${encodeURIComponent(emailToCheck)}`)
    const json = await res.json()
    return json.allowed === true
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const allowed = await checkWhitelist(email)
    if (!allowed) {
      const params = new URLSearchParams({ name, email })
      router.push(`/waitlist?${params}`)
      return
    }

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

    if (signupError) {
      setError(signupError.message)
      setLoading(false)
      return
    }

    if (data.session) {
      router.push(accountType === 'creator' ? '/onboarding' : '/discover')
    } else {
      setLoading(false)
      setAwaitingConfirmation(true)
    }
  }

  async function handleGoogleSignup() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding&account_type=${accountType}`,
        queryParams: { account_type: accountType },
      },
    })
  }

  if (awaitingConfirmation) {
    return (
      <div className="editorial-shell min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <Link href="/" className="inline-block text-2xl font-bold text-[#17332d]">TripKits</Link>
          <div className="editorial-card space-y-4 p-8">
            <div className="text-4xl">Mailbox</div>
            <h2 className="text-lg font-semibold text-[#17332d]">Check your email</h2>
            <p className="editorial-subtle text-sm leading-relaxed">
              We sent a confirmation link to <strong className="text-[#17332d]/84">{email}</strong>.
              Click it to activate your account, then come back and sign in.
            </p>
            <Link href="/login" className="btn-primary mt-2 inline-block text-sm">
              Go to sign in {'->'}
            </Link>
          </div>
          <p className="editorial-muted text-xs">Did not receive it? Check your spam folder.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="editorial-shell min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold text-[#17332d]">TripKits</Link>
          <p className="editorial-subtle mt-2 text-sm">Create your free account</p>
        </div>

        <div className="editorial-card space-y-4 p-8">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#17332d]/6 p-1">
            {(['creator', 'subscriber'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAccountType(type)}
                className={`rounded-lg py-2 text-sm font-medium transition-all ${
                  accountType === type ? 'bg-[#17332d] text-[#fff7ef]' : 'text-[#17332d]/58 hover:text-[#17332d]'
                }`}
              >
                {type === 'creator' ? 'Creator' : 'Traveler'}
              </button>
            ))}
          </div>

          <button
            onClick={handleGoogleSignup}
            className="w-full rounded-xl border border-[#17332d]/12 py-3 text-sm text-[#17332d]/78 transition-all hover:border-[#17332d]/24 hover:text-[#17332d]"
          >
            Continue with Google
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#17332d]/10" /></div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#f7efe3] px-3 text-[#17332d]/35">or</span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <input
              type="text"
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="editorial-input"
            />
            {accountType === 'creator' ? (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#17332d]/35">@</span>
                <input
                  type="text"
                  placeholder="your-handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required
                  className="editorial-input pl-8"
                />
              </div>
            ) : null}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="editorial-input"
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              className="editorial-input"
            />
            {error ? <p className="text-xs text-red-700">{error}</p> : null}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm disabled:opacity-50">
              {loading ? 'Creating account...' : accountType === 'creator' ? 'Create my creator portal ->' : 'Start exploring ->'}
            </button>
          </form>

          <p className="editorial-muted text-center text-xs">
            Already have an account? <Link href="/login" className="text-[#17332d] hover:underline">Sign in</Link>
          </p>

          <p className="editorial-muted text-center text-[10px]">
            By continuing you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  )
}
