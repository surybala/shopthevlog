'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function WaitlistForm() {
  const searchParams = useSearchParams()

  const [name, setName] = useState(searchParams.get('name') ?? '')
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const prefilled = !!(searchParams.get('name') || searchParams.get('email'))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, reason }),
    })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Something went wrong. Please try again.')
    } else {
      setSubmitted(true)
    }
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center">
        <Link href="/" className="mb-6 inline-block text-2xl font-bold text-[#17332d]">
          VlogShopper
        </Link>
        <div className="mb-4 text-5xl">Pass</div>
        <h1 className="mb-2 text-3xl font-bold text-[#17332d]">Early access only</h1>
        <p className="editorial-subtle text-sm leading-relaxed">
          VlogShopper is in private beta. Request access below and we will email you when your spot is ready.
        </p>
      </div>

      {submitted ? (
        <div className="editorial-card space-y-4 p-8 text-center">
          <div className="text-4xl">Sent</div>
          <h2 className="text-lg font-semibold text-[#17332d]">You are on the list</h2>
          <p className="editorial-subtle text-sm leading-relaxed">
            We sent a confirmation to <strong className="text-[#17332d]/84">{email}</strong>.
            We will reach out as soon as your spot opens up.
          </p>
          <Link href="/discover" className="btn-primary mt-2 inline-block text-sm">
            Browse storefronts while you wait {'->'}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="editorial-card space-y-4 p-8">
          {prefilled ? (
            <p className="rounded-lg border border-[#17332d]/10 bg-white/55 px-3 py-2 text-xs leading-relaxed text-[#17332d]/66">
              Your details are pre-filled from the signup page. Add an optional note and request access.
            </p>
          ) : null}
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="editorial-input"
          />
          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="editorial-input"
          />
          <textarea
            placeholder="Why do you want early access? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="editorial-input resize-none"
          />
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm disabled:opacity-50">
            {loading ? 'Submitting...' : 'Request early access ->'}
          </button>
        </form>
      )}

      <div className="flex flex-col justify-center gap-3 text-sm sm:flex-row">
        <Link href="/discover" className="editorial-muted text-center transition-colors hover:text-[#17332d]">
          Browse public storefronts
        </Link>
        <span className="hidden sm:inline text-[#17332d]/25">·</span>
        <Link href="/login" className="editorial-muted text-center transition-colors hover:text-[#17332d]">
          Already approved? Sign in
        </Link>
      </div>

      <p className="editorial-muted text-center text-xs">© 2026 VlogShopper · Private beta</p>
    </div>
  )
}

export default function WaitlistPage() {
  return (
    <div className="editorial-shell min-h-screen flex items-center justify-center px-6">
      <Suspense
        fallback={
          <div className="w-full max-w-md animate-pulse space-y-8">
            <div className="space-y-4 text-center">
              <div className="mx-auto h-8 w-40 rounded bg-[#17332d]/10" />
              <div className="mx-auto h-6 w-56 rounded bg-[#17332d]/10" />
            </div>
            <div className="editorial-card space-y-4 p-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-11 rounded-xl bg-[#17332d]/8" />
              ))}
            </div>
          </div>
        }
      >
        <WaitlistForm />
      </Suspense>
    </div>
  )
}
