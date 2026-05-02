'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export default function ReviewEditForm({
  opportunityId,
  initialTitle,
  initialDescription,
}: {
  opportunityId: string
  initialTitle: string
  initialDescription: string | null
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    try {
      const response = await fetch(`/api/opportunities/${opportunityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not save opportunity')
      }

      setSaved(true)
      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save opportunity')
    }
  }

  return (
    <form onSubmit={onSubmit} className="dashboard-mirror-card space-y-3 p-4">
      <div>
        <label className="dashboard-mirror-kicker mb-1 block text-[11px]">Title</label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="dashboard-input"
        />
      </div>
      <div>
        <label className="dashboard-mirror-kicker mb-1 block text-[11px]">Description</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="dashboard-input min-h-28 resize-none"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs">
          {error ? <span className="text-red-300">{error}</span> : null}
          {!error && saved ? <span className="text-emerald-300">Saved</span> : null}
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="dashboard-pill-button text-xs text-cyan-100 ring-cyan-400/20 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Edit'}
        </button>
      </div>
    </form>
  )
}
