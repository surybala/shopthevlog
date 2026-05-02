'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type CommissionRow = {
  id: string
  creatorName: string
  creatorHandle: string
  affiliateTargetName: string
  provider: string
  status: 'PENDING' | 'CONFIRMED' | 'PAID' | 'REVERSED'
  creatorEarnings: number
  createdAt: string | Date
  convertedAt: string | Date
  paidAt: string | Date | null
  attributedTripKitTitle: string | null
}

type BulkAction = 'confirm' | 'mark_paid' | 'reverse'

const actionLabels: Record<BulkAction, string> = {
  confirm: 'Confirm selected',
  mark_paid: 'Mark paid',
  reverse: 'Reverse selected',
}

function formatUsdFromCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

function badgeClass(status: CommissionRow['status']) {
  switch (status) {
    case 'CONFIRMED':
      return 'bg-blue-500/14 text-blue-950'
    case 'PAID':
      return 'bg-emerald-500/16 text-emerald-950'
    case 'REVERSED':
      return 'bg-rose-500/18 text-rose-950'
    default:
      return 'bg-amber-500/18 text-amber-950'
  }
}

export default function PayoutOpsTable({
  title,
  description,
  rows,
  actions = [],
}: {
  title: string
  description: string
  rows: CommissionRow[]
  actions?: BulkAction[]
}) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busyAction, setBusyAction] = useState<BulkAction | null>(null)
  const [error, setError] = useState('')

  const selectableRows = useMemo(() => new Set(rows.map((row) => row.id)), [rows])

  function toggleSelection(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  function toggleAll() {
    setSelectedIds((current) =>
      current.length === rows.length ? [] : rows.map((row) => row.id),
    )
  }

  async function runAction(action: BulkAction) {
    if (!selectedIds.length) return

    setBusyAction(action)
    setError('')

    const response = await fetch('/api/admin/payout-ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, commissionIds: selectedIds }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(body.error ?? 'Could not update commissions.')
      setBusyAction(null)
      return
    }

    setSelectedIds((current) => current.filter((id) => !selectableRows.has(id)))
    setBusyAction(null)
    router.refresh()
  }

  return (
    <div className="dashboard-mirror-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(23,51,45,0.08)] pb-4">
        <div>
          <h2 className="font-semibold text-[#17332d]">{title}</h2>
          <p className="mt-1 text-xs text-[rgba(23,51,45,0.58)]">{description}</p>
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="dashboard-action-chip text-xs"
              aria-label={`Select all commissions in ${title}`}
            >
              {selectedIds.length === rows.length && rows.length > 0 ? 'Clear selection' : 'Select all'}
            </button>
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={!selectedIds.length || busyAction !== null}
                onClick={() => runAction(action)}
                className={
                  action === 'mark_paid'
                    ? 'btn-primary text-xs disabled:opacity-50'
                    : 'btn-ghost text-xs disabled:opacity-50'
                }
              >
                {busyAction === action ? 'Working...' : actionLabels[action]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[rgba(23,51,45,0.62)]">Nothing to action here right now.</div>
      ) : (
        <div className="divide-y divide-[rgba(23,51,45,0.08)]">
          {rows.map((row) => (
            <label key={row.id} className="flex cursor-pointer flex-wrap items-start gap-4 px-1 py-4">
              {actions.length > 0 ? (
                <input
                  type="checkbox"
                  checked={selectedIds.includes(row.id)}
                  onChange={() => toggleSelection(row.id)}
                  aria-label={`Select commission ${row.affiliateTargetName} for ${row.creatorHandle}`}
                  className="mt-1 h-4 w-4 rounded border-[rgba(23,51,45,0.18)] text-[#17332d] focus:ring-[#17332d]/30"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#17332d]">{row.creatorName}</p>
                  <span className="text-xs text-[rgba(23,51,45,0.52)]">@{row.creatorHandle}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${badgeClass(row.status)}`}>
                    {row.status}
                  </span>
                </div>

                <p className="mt-1 text-sm text-[rgba(23,51,45,0.72)]">{row.affiliateTargetName}</p>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgba(23,51,45,0.56)]">
                  <span>{row.provider.replace(/_/g, ' ')}</span>
                  <span>Converted {new Date(row.convertedAt).toLocaleDateString()}</span>
                  {row.attributedTripKitTitle ? <span>Kit: {row.attributedTripKitTitle}</span> : <span>Kit: Unattributed</span>}
                  {row.paidAt ? <span>Paid {new Date(row.paidAt).toLocaleDateString()}</span> : null}
                </div>
              </div>

              <div className="ml-auto flex shrink-0 flex-col items-end text-right">
                <p className="text-lg font-semibold text-[#17332d]">{formatUsdFromCents(row.creatorEarnings)}</p>
                <p className="text-xs text-[rgba(23,51,45,0.52)]">
                  Logged {new Date(row.createdAt).toLocaleDateString()}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
