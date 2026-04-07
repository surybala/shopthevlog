'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UnfollowButton({ creatorHandle }: { creatorHandle: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleUnfollow() {
    setLoading(true)
    try {
      await fetch(`/api/account/follow?creatorHandle=${encodeURIComponent(creatorHandle)}`, {
        method: 'DELETE',
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleUnfollow}
      disabled={loading}
      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      {loading ? '…' : 'Unfollow'}
    </button>
  )
}
