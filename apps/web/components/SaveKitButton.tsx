'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  kitId: string
  initialSaved: boolean
  isLoggedIn: boolean
  creatorHandle: string
}

export default function SaveKitButton({ kitId, initialSaved, isLoggedIn, creatorHandle }: Props) {
  const router = useRouter()
  const [saved, setSaved] = useState(initialSaved)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function toggle() {
    if (!isLoggedIn) {
      router.push(`/login?next=/@${creatorHandle}`)
      return
    }

    setLoading(true)
    setError('')
    try {
      if (saved) {
        const res = await fetch(`/api/account/saved-kits?kitId=${kitId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not unsave kit')
        setSaved(false)
      } else {
        const res = await fetch('/api/account/saved-kits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kitId }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save kit')
        setSaved(true)
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={loading}
        aria-label={saved ? 'Unsave kit' : 'Save kit'}
        className={`creator portal-outline-button rounded-xl ${
          saved ? 'creator portal-outline-button--active' : ''
        }`}
      >
        <span>{saved ? '★' : '☆'}</span>
        <span>{loading ? '...' : saved ? 'Saved' : 'Save'}</span>
      </button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
