'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Request = {
  id: string
  name: string
  email: string
  reason: string | null
  status: string
  createdAt: Date | string
  approvedAt: Date | string | null
  rejectedAt?: Date | string | null
}

export default function WaitlistTable({
  requests,
  showApprove = false,
}: {
  requests: Request[]
  showApprove?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Record<string, 'approving' | 'rejecting'>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function doAction(id: string, action: 'approve' | 'reject') {
    setBusy(prev => ({ ...prev, [id]: action === 'approve' ? 'approving' : 'rejecting' }))
    setErrors(prev => ({ ...prev, [id]: '' }))

    const res = await fetch(`/api/admin/waitlist/${id}/${action}`, { method: 'POST' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setErrors(prev => ({ ...prev, [id]: json.error ?? `Failed to ${action}` }))
    } else {
      router.refresh()
    }
    setBusy(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  return (
    <div className="space-y-3">
      {requests.map(r => (
        <div key={r.id} className="glass-card p-5 flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm">{r.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                r.status === 'APPROVED' ? 'bg-green-500/20 text-green-400'
                : r.status === 'REJECTED' ? 'bg-red-500/20 text-red-400'
                : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {r.status}
              </span>
            </div>
            <p className="text-white/50 text-xs mt-0.5">{r.email}</p>
            {r.reason && (
              <p className="text-white/40 text-xs mt-2 leading-relaxed italic">"{r.reason}"</p>
            )}
            <p className="text-white/20 text-xs mt-2">
              Requested {new Date(r.createdAt).toLocaleDateString()}
              {r.approvedAt && ` · Approved ${new Date(r.approvedAt).toLocaleDateString()}`}
              {r.rejectedAt && ` · Rejected ${new Date(r.rejectedAt).toLocaleDateString()}`}
            </p>
            {errors[r.id] && (
              <p className="text-red-400 text-xs mt-1">{errors[r.id]}</p>
            )}
          </div>

          {/* Actions — only shown for PENDING rows */}
          {showApprove && r.status === 'PENDING' && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => doAction(r.id, 'approve')}
                disabled={!!busy[r.id]}
                className="btn-primary text-xs px-4 py-2 disabled:opacity-50"
              >
                {busy[r.id] === 'approving' ? 'Approving…' : 'Approve ✓'}
              </button>
              <button
                onClick={() => doAction(r.id, 'reject')}
                disabled={!!busy[r.id]}
                className="text-xs px-4 py-2 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {busy[r.id] === 'rejecting' ? 'Rejecting…' : 'Reject ✕'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
