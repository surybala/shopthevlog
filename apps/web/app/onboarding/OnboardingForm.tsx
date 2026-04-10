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
    if (!handleEdited) setHandle(deriveHandle(val))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!handle.match(/^[a-z0-9_]{2,30}$/)) {
      setError('Handle must be 2-30 characters: lowercase letters, numbers, underscores only')
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
    <form onSubmit={handleSubmit} className="editorial-card space-y-5 p-8">
      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#17332d]/62">Display name</label>
        <input
          type="text"
          required
          value={displayName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Alex Travels"
          className="editorial-input"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#17332d]/62">Handle</label>
        <div className="flex items-center overflow-hidden rounded-lg border border-[#17332d]/12 bg-white/74 transition-colors focus-within:border-[#17332d]/24">
          <span className="select-none pl-4 pr-1 text-sm text-[#17332d]/38">@</span>
          <input
            type="text"
            required
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
              setHandleEdited(true)
            }}
            placeholder="yourhandle"
            maxLength={30}
            className="flex-1 bg-transparent px-1 py-2.5 text-sm text-[#17332d] placeholder-[#17332d]/35 outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-[#17332d]/44">Your storefront will be at vlogshopper.com/@{handle || 'yourhandle'}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#17332d]/62">
          Bio <span className="text-[#17332d]/36">(optional)</span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell people what you are about..."
          rows={3}
          maxLength={280}
          className="editorial-input resize-none"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#17332d]/62">
          Location <span className="text-[#17332d]/36">(optional)</span>
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Bali, Indonesia"
          className="editorial-input"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Setting up...' : 'Set up my storefront ->'}
      </button>
    </form>
  )
}
