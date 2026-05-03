'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { buildBriefStatusDisplay, type BriefStatus } from '@/lib/channelInsights'

export function BriefStatusButton({
  briefId,
  initialStatus,
}: {
  briefId: string
  initialStatus: BriefStatus
}) {
  const [status, setStatus] = useState<BriefStatus>(initialStatus)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const display = buildBriefStatusDisplay(status)

  const toneClasses: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    slate: 'bg-[#17332d]/6 text-[#17332d]/66 ring-1 ring-[#17332d]/12',
  }

  async function advance() {
    if (!display.canAdvance || isPending) return
    const next = display.nextStatus
    const res = await fetch(`/api/insights/briefs/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefStatus: next }),
    })
    if (res.ok) {
      setStatus(next)
      startTransition(() => router.refresh())
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[display.tone]}`}>
        {display.label}
      </span>
      {display.canAdvance && (
        <button
          onClick={advance}
          disabled={isPending}
          className="text-xs text-[#17332d]/50 underline underline-offset-2 hover:text-[#17332d] disabled:opacity-40"
        >
          {isPending ? 'Saving…' : display.nextLabel}
        </button>
      )}
    </div>
  )
}
