'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export default function ReviewDecisionButtons({
  opportunityId,
  reviewState,
}: {
  opportunityId: string
  reviewState: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null)

  async function submit(action: 'approve' | 'reject') {
    setError(null)
    setPendingAction(action)

    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/${action}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? `Could not ${action} opportunity`)
      }

      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} opportunity`)
    } finally {
      setPendingAction(null)
    }
  }

  const approveDisabled = isPending || pendingAction === 'reject' || reviewState === 'APPROVED'
  const rejectDisabled = isPending || pendingAction === 'approve' || reviewState === 'REJECTED'

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit('approve')}
          disabled={approveDisabled}
          className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300 transition-colors hover:border-emerald-400/60 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => submit('reject')}
          disabled={rejectDisabled}
          className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition-colors hover:border-red-400/60 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
