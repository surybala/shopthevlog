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
        className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-[rgba(45,94,191,0.18)] bg-[linear-gradient(135deg,rgba(103,147,233,0.16),rgba(82,124,212,0.06))] px-4 py-2 text-sm font-medium leading-none text-[#214d8f] transition-colors hover:bg-[linear-gradient(135deg,rgba(103,147,233,0.24),rgba(82,124,212,0.12))] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? `${actionLabel}...` : actionLabel}
      </button>
      {error ? <p className="text-xs text-[#9f3a24]">{error}</p> : null}
    </div>
  )
}
