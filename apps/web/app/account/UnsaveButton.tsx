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
      className="text-xs px-2 py-1 rounded border border-white/10 text-white/30 hover:border-red-500/30 hover:text-red-400 transition-colors disabled:opacity-50"
      title="Remove from saved"
    >
      {loading ? '…' : '✕'}
    </button>
  )
}
