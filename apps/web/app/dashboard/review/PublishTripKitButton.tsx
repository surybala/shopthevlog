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
        className="rounded-lg border border-sky-500/30 px-3 py-2 text-sm text-sky-200 transition-colors hover:border-sky-400/60 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? `${actionLabel}...` : actionLabel}
      </button>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
