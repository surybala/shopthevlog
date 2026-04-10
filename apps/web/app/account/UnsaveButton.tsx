'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UnsaveButton({ kitId }: { kitId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleUnsave() {
    setLoading(true)
    try {
      await fetch(`/api/account/saved-kits?kitId=${encodeURIComponent(kitId)}`, {
        method: 'DELETE',
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleUnsave}
      disabled={loading}
      className="dashboard-pill-button text-xs text-[#d2d9c7]/72 hover:border-red-400/35 hover:bg-red-400/10 hover:text-[#ffb5a8] disabled:opacity-50"
      title="Remove from saved"
    >
      {loading ? 'Removing...' : 'Remove'}
    </button>
  )
}
