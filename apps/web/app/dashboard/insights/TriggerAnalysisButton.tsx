'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const POLL_INTERVAL_MS = 5_000

type Props = {
  canTrigger: boolean
  isRunning: boolean
  description: string
}

export default function TriggerAnalysisButton({ canTrigger, isRunning, description }: Props) {
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync polling with isRunning prop — covers the case where the page loads
  // while analysis is already in flight (e.g. user navigates away and back)
  useEffect(() => {
    if (isRunning && !polling) setPolling(true)
  }, [isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start/stop the polling interval
  useEffect(() => {
    if (!polling) return

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/insights')
        if (!res.ok) return
        const { insight } = await res.json()
        const status = insight?.status
        if (status !== 'QUEUED' && status !== 'ANALYZING') {
          clearInterval(pollRef.current!)
          setPolling(false)
          router.refresh()
        }
      } catch {
        // transient error — keep polling
      }
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [polling, router])

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
        setPolling(true)
      }
    } catch {
      setError('Unexpected error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (isRunning || polling) {
    return (
      <p className="dashboard-mirror-subtle text-xs">{description}</p>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleTrigger}
        disabled={!canTrigger || loading}
        className="rounded-lg bg-[#17332d] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ color: '#ffffff' }}
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
