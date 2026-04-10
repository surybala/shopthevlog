'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export default function PublishTripKitButton({
  vlogId,
  disabled,
  actionLabel,
}: {
  vlogId: string
  disabled: boolean
  actionLabel: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function publish() {
    setError(null)

    try {
      const response = await fetch(`/api/vlogs/${vlogId}/publish`, {
        method: 'POST',
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not publish Trip Kit')
      }

      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish Trip Kit')
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={publish}
        disabled={disabled || isPending}
        className="dashboard-pill-button bg-[linear-gradient(135deg,rgba(90,146,255,0.18),rgba(66,116,212,0.08))] text-sky-100 ring-sky-400/20 hover:bg-[linear-gradient(135deg,rgba(90,146,255,0.28),rgba(66,116,212,0.14))] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? `${actionLabel}...` : actionLabel}
      </button>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
