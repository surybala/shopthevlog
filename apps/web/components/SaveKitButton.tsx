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
      className={`storefront-outline-button rounded-xl ${
        saved ? 'storefront-outline-button--active' : ''
      }`}
    >
      <span>{saved ? '★' : '☆'}</span>
      <span>{loading ? '...' : saved ? 'Saved' : 'Save'}</span>
    </button>
  )
}
