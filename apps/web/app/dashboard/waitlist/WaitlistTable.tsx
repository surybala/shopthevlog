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
    setBusy((prev) => ({ ...prev, [id]: action === 'approve' ? 'approving' : 'rejecting' }))
    setErrors((prev) => ({ ...prev, [id]: '' }))

    const res = await fetch(`/api/admin/waitlist/${id}/${action}`, { method: 'POST' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setErrors((prev) => ({ ...prev, [id]: json.error ?? `Failed to ${action}` }))
    } else {
      router.refresh()
    }
    setBusy((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div key={request.id} className="dashboard-mirror-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#17332d]">{request.name}</span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ${
                  request.status === 'APPROVED'
                    ? 'bg-green-500/16 text-green-100 ring-green-400/20'
                    : request.status === 'REJECTED'
                      ? 'bg-red-500/16 text-red-100 ring-red-400/20'
                      : 'bg-yellow-500/16 text-yellow-100 ring-yellow-300/20'
                }`}
              >
                {request.status}
              </span>
            </div>

            <p className="mt-0.5 text-xs text-[rgba(23,51,45,0.66)]">{request.email}</p>

            {request.reason ? (
              <p className="mt-2 text-sm italic leading-relaxed text-[rgba(23,51,45,0.72)]">"{request.reason}"</p>
            ) : null}

            <p className="mt-2 text-xs text-[rgba(23,51,45,0.56)]">
              Requested {new Date(request.createdAt).toLocaleDateString()}
              {request.approvedAt ? ` · Approved ${new Date(request.approvedAt).toLocaleDateString()}` : ''}
              {request.rejectedAt ? ` · Rejected ${new Date(request.rejectedAt).toLocaleDateString()}` : ''}
            </p>

            {errors[request.id] ? <p className="mt-1 text-xs text-red-200">{errors[request.id]}</p> : null}
          </div>

          {showApprove && request.status === 'PENDING' ? (
            <div className="flex shrink-0 gap-2">
              <button onClick={() => doAction(request.id, 'approve')} disabled={!!busy[request.id]} className="btn-primary text-xs disabled:opacity-50">
                {busy[request.id] === 'approving' ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => doAction(request.id, 'reject')}
                disabled={!!busy[request.id]}
                className="dashboard-pill-button text-xs text-[#c95d49] hover:bg-red-400/10 hover:text-[#a73e2d] disabled:opacity-50"
              >
                {busy[request.id] === 'rejecting' ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
