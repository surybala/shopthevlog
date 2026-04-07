'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  creatorHandle: string
  initialFollowing: boolean
  isLoggedIn: boolean
  /** Optional extra classes for the button */
  className?: string
  size?: 'sm' | 'default'
}

export default function FollowButton({
  creatorHandle,
  initialFollowing,
  isLoggedIn,
  className = '',
  size = 'default',
}: Props) {
  const router = useRouter()
  const [following, setFollowing] = useState(initialFollowing)
  const [loading, setLoading] = useState(false)

  const sizeCls = size === 'sm' ? 'text-sm py-1.5 px-4' : 'text-sm py-2 px-6'

  async function handleClick() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/@${creatorHandle}/subscribe`)}`)
      return
    }

    setLoading(true)
    try {
      if (following) {
        await fetch(`/api/account/follow?creatorHandle=${encodeURIComponent(creatorHandle)}`, {
          method: 'DELETE',
        })
        setFollowing(false)
      } else {
        const res = await fetch('/api/account/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorHandle }),
        })
        if (res.ok) setFollowing(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`${sizeCls} font-medium rounded-xl transition-colors disabled:opacity-50 ${
        following
          ? 'border border-white/20 text-white/60 hover:border-red-500/40 hover:text-red-400 bg-transparent'
          : 'btn-primary'
      } ${className}`}
    >
      {loading ? '…' : following ? 'Following' : 'Follow'}
    </button>
  )
}
