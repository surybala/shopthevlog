'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  kitId:        string
  initialSaved: boolean
  isLoggedIn:   boolean
  creatorHandle: string
}

export default function SaveKitButton({ kitId, initialSaved, isLoggedIn, creatorHandle }: Props) {
  const router = useRouter()
  const [saved, setSaved]   = useState(initialSaved)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (!isLoggedIn) {
      router.push(`/login?next=/@${creatorHandle}`)
      return
    }

    setLoading(true)
    try {
      if (saved) {
        await fetch(`/api/account/saved-kits?kitId=${kitId}`, { method: 'DELETE' })
        setSaved(false)
      } else {
        await fetch('/api/account/saved-kits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kitId }),
        })
        setSaved(true)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-label={saved ? 'Unsave kit' : 'Save kit'}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
        saved
          ? 'bg-white/10 border-white/20 text-white hover:bg-white/5'
          : 'border-white/20 text-white/60 hover:text-white hover:border-white/40'
      }`}
    >
      <span>{saved ? '★' : '☆'}</span>
      {saved ? 'Saved' : 'Save'}
    </button>
  )
}
