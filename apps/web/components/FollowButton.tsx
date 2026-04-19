'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  creatorHandle: string
  initialFollowing: boolean
  isLoggedIn: boolean
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
  const [error, setError] = useState('')

  const sizeCls = size === 'sm' ? 'px-4 py-1.5 text-sm' : 'px-6 py-2 text-sm'

  async function handleClick() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/@${creatorHandle}/subscribe`)}`)
      return
    }

    setLoading(true)
    setError('')
    try {
      if (following) {
        const res = await fetch(`/api/account/follow?creatorHandle=${encodeURIComponent(creatorHandle)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not unfollow')
        setFollowing(false)
      } else {
        const res = await fetch('/api/account/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorHandle }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not follow')
        setFollowing(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`${sizeCls} disabled:opacity-50 ${
          following ? 'storefront-outline-button storefront-outline-button--active' : 'btn-primary'
        } ${className}`}
      >
        {loading ? '...' : following ? 'Following' : 'Follow'}
      </button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
