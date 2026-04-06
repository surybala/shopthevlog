'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OnboardingForm() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function deriveHandle(name: string) {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30)
  }

  function handleNameChange(val: string) {
    setDisplayName(val)
    if (!handleEdited) {
      setHandle(deriveHandle(val))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!handle.match(/^[a-z0-9_]{2,30}$/)) {
      setError('Handle must be 2–30 characters: lowercase letters, numbers, underscores only')
      return
    }

    setLoading(true)
    const res = await fetch('/api/creator/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, handle, bio: bio || undefined, location: location || undefined }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-white/60 mb-1.5">Display name</label>
        <input
          type="text"
          required
          value={displayName}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="e.g. Alex Travels"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-white/60 mb-1.5">Handle</label>
        <div className="flex items-center rounded-lg bg-white/5 border border-white/10 focus-within:border-white/30 transition-colors overflow-hidden">
          <span className="pl-4 pr-1 text-sm text-white/40 select-none">@</span>
          <input
            type="text"
            required
            value={handle}
            onChange={e => { setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setHandleEdited(true) }}
            placeholder="yourhandle"
            maxLength={30}
            className="flex-1 bg-transparent px-1 py-2.5 text-sm text-white placeholder-white/30 outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-white/30">Your storefront will be at vlogshopper.com/@{handle || 'yourhandle'}</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-white/60 mb-1.5">Bio <span className="text-white/30">(optional)</span></label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="Tell people what you're about…"
          rows={3}
          maxLength={280}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-white/60 mb-1.5">Location <span className="text-white/30">(optional)</span></label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="e.g. Bali, Indonesia"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-white text-black font-semibold text-sm py-2.5 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Setting up…' : 'Set up my storefront →'}
      </button>
    </form>
  )
}
