'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function WaitlistPage() {
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [reason, setReason]   = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]     = useState('')

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
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        {/* Brand */}
        <div className="text-center">
          <Link href="/" className="inline-block text-2xl font-bold text-white mb-6">
            VlogShopper
          </Link>
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-3xl font-bold text-white mb-2">Early access only</h1>
          <p className="text-white/50 text-sm leading-relaxed">
            VlogShopper is in private beta. Request access below and we'll
            email you when your spot is ready.
          </p>
        </div>

        {submitted ? (
          /* ── Success state ─────────────────────────────────────────────── */
          <div className="glass-card p-8 text-center space-y-4">
            <div className="text-4xl">📬</div>
            <h2 className="text-lg font-semibold text-white">You're on the list!</h2>
            <p className="text-white/50 text-sm leading-relaxed">
              We've sent a confirmation to <strong className="text-white/70">{email}</strong>.
              We'll reach out as soon as your spot opens up.
            </p>
            <Link href="/discover" className="btn-primary text-sm inline-block mt-2">
              Browse storefronts while you wait →
            </Link>
          </div>
        ) : (
          /* ── Request form ──────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="glass-card p-8 space-y-4">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <input
              type="email"
              placeholder="Your email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <textarea
              placeholder="Why do you want early access? (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 text-sm disabled:opacity-50"
            >
              {loading ? 'Submitting…' : 'Request early access →'}
            </button>
          </form>
        )}

        {/* Footer links */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center text-sm">
          <Link href="/discover" className="text-white/40 hover:text-white transition-colors text-center">
            Browse public storefronts
          </Link>
          <span className="hidden sm:inline text-white/20">·</span>
          <Link href="/login" className="text-white/40 hover:text-white transition-colors text-center">
            Already approved? Sign in
          </Link>
        </div>

        <p className="text-white/20 text-xs text-center">© 2025 VlogShopper · Private beta</p>
      </div>
    </div>
  )
}
