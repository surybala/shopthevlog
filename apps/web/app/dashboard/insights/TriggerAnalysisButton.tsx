'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  canTrigger: boolean
  isRunning: boolean
  description: string
}

export default function TriggerAnalysisButton({ canTrigger, isRunning, description }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleTrigger() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/insights/trigger', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not start analysis.')
      } else {
        router.refresh()
      }
    } catch {
      setError('Unexpected error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (isRunning) {
    return (
      <p className="dashboard-mirror-subtle text-xs">{description}</p>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleTrigger}
        disabled={!canTrigger || loading}
        className="rounded-lg bg-[#17332d] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {loading ? 'Starting…' : 'Run Analysis'}
      </button>
      {!loading && (
        <p className="dashboard-mirror-subtle text-xs">{description}</p>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </div>
  )
}
