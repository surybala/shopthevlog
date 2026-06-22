'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ResolveType = 'accommodation' | 'experience' | 'flight'

const resolveOptions: Array<{ value: ResolveType; label: string }> = [
  { value: 'accommodation', label: 'Stay or hotel' },
  { value: 'experience', label: 'Tour or experience' },
  { value: 'flight', label: 'Flight' },
]

export default function AffiliateLinkComposer() {
  const router = useRouter()
  const [manualSaving, setManualSaving] = useState(false)
  const [resolveSaving, setResolveSaving] = useState(false)
  const [manualError, setManualError] = useState('')
  const [resolveError, setResolveError] = useState('')
  const [manual, setManual] = useState({
    targetName: '',
    targetUrl: '',
    activityType: 'OTHER',
  })
  const [resolved, setResolved] = useState({
    name: '',
    city: '',
    country: '',
    type: 'accommodation' as ResolveType,
  })

  async function submitManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setManualSaving(true)
    setManualError('')
    try {
      const res = await fetch('/api/affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not create affiliate link')
      }

      router.push('/dashboard/affiliates')
      router.refresh()
    } catch (error) {
      setManualError(error instanceof Error ? error.message : 'Could not create affiliate link')
    } finally {
      setManualSaving(false)
    }
  }

  async function submitResolved(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setResolveSaving(true)
    setResolveError('')
    try {
      const res = await fetch('/api/affiliate-links/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolved),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not resolve affiliate link')
      }

      router.push('/dashboard/affiliates')
      router.refresh()
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : 'Could not resolve affiliate link')
    } finally {
      setResolveSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={submitManual} className="dashboard-mirror-card p-6">
        <p className="dashboard-mirror-kicker text-xs">Manual link</p>
        <h2 className="mt-3 text-2xl font-semibold text-[#17332d]">Paste an affiliate URL you already have.</h2>
        <p className="dashboard-mirror-subtle mt-2 text-sm">
          Great for Amazon, Booking.com, or any partner link you already generated elsewhere.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Link label</label>
            <input
              className="dashboard-input"
              placeholder="Park Hyatt Tokyo"
              value={manual.targetName}
              onChange={(e) => setManual((prev) => ({ ...prev, targetName: e.target.value }))}
            />
          </div>
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Affiliate URL</label>
            <input
              className="dashboard-input"
              placeholder="https://..."
              value={manual.targetUrl}
              onChange={(e) => setManual((prev) => ({ ...prev, targetUrl: e.target.value }))}
            />
          </div>
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Activity type</label>
            <select
              className="dashboard-input"
              value={manual.activityType}
              onChange={(e) => setManual((prev) => ({ ...prev, activityType: e.target.value }))}
            >
              <option value="ACCOMMODATION">Accommodation</option>
              <option value="FOOD">Food</option>
              <option value="TRANSPORT">Transport</option>
              <option value="TOUR">Tour</option>
              <option value="ATTRACTION">Attraction</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        {manualError ? <p className="mt-4 text-sm text-red-700">{manualError}</p> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={manualSaving || !manual.targetName || !manual.targetUrl}
            className="btn-primary disabled:opacity-50"
          >
            {manualSaving ? 'Saving link...' : 'Save affiliate link'}
          </button>
          <button type="button" onClick={() => router.push('/dashboard/affiliates')} className="btn-ghost">
            Cancel
          </button>
        </div>
      </form>

      <form onSubmit={submitResolved} className="dashboard-mirror-card p-6">
        <p className="dashboard-mirror-kicker text-xs">Smart resolve</p>
        <h2 className="mt-3 text-2xl font-semibold text-[#17332d]">Let TripMirror look up the partner link for you.</h2>
        <p className="dashboard-mirror-subtle mt-2 text-sm">
          Best for hotels, tours, and flights when you know the place but do not already have the affiliate URL.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Name</label>
            <input
              className="dashboard-input"
              placeholder="Park Hyatt Tokyo"
              value={resolved.name}
              onChange={(e) => setResolved((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">City</label>
            <input
              className="dashboard-input"
              placeholder="Tokyo"
              value={resolved.city}
              onChange={(e) => setResolved((prev) => ({ ...prev, city: e.target.value }))}
            />
          </div>
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Country</label>
            <input
              className="dashboard-input"
              placeholder="Japan"
              value={resolved.country}
              onChange={(e) => setResolved((prev) => ({ ...prev, country: e.target.value }))}
            />
          </div>
          <div>
            <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Link type</label>
            <div className="flex flex-wrap gap-2">
              {resolveOptions.map((option) => {
                const active = resolved.type === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setResolved((prev) => ({ ...prev, type: option.value }))}
                    className={
                      active
                        ? 'dashboard-pill-button bg-[#17332d] text-[#fff7ef] hover:bg-[#17332d]'
                        : 'dashboard-pill-button'
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {resolveError ? <p className="mt-4 text-sm text-red-700">{resolveError}</p> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={resolveSaving || !resolved.name || !resolved.city}
            className="btn-primary disabled:opacity-50"
          >
            {resolveSaving ? 'Resolving link...' : 'Resolve affiliate link'}
          </button>
          <button type="button" onClick={() => router.push('/dashboard/affiliates')} className="btn-ghost">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
