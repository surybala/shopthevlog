'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatVlogPipelineErrorMessage } from '@/lib/vlogProcessing'

type TripKitRef = {
  id: string
  title: string
  slug: string
  isPublished: boolean
}

type Vlog = {
  id: string
  title: string
  thumbnailUrl: string | null
  externalUrl: string
  publishedAt: string | null
  platform: string
  processingStatus: string
  pipelineError?: string | null
  processedAt: string | null
  tripKits: { tripKit: TripKitRef }[]
}

interface Props {
  initialVlogs: Vlog[]
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-[#17332d]/8 text-[#17332d]/76',
  QUEUED: 'bg-blue-500/14 text-blue-900',
  TRANSCRIBING: 'bg-yellow-500/16 text-yellow-900 animate-pulse',
  EXTRACTING: 'bg-purple-500/16 text-purple-900 animate-pulse',
  EMBEDDING: 'bg-orange-500/18 text-orange-900 animate-pulse',
  COMPLETE: 'bg-green-500/18 text-green-900',
  FAILED: 'bg-red-500/18 text-red-900',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  TRANSCRIBING: 'Transcribing...',
  EXTRACTING: 'Generating Kit...',
  EMBEDDING: 'Embedding...',
  COMPLETE: 'Complete',
  REVIEW_PENDING: 'Ready for Review',
  FAILED: 'Failed',
}

const IN_PROGRESS = new Set(['QUEUED', 'TRANSCRIBING', 'EXTRACTING', 'EMBEDDING'])

export default function VlogsClient({ initialVlogs }: Props) {
  const [vlogs, setVlogs] = useState<Vlog[]>(initialVlogs)
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const anyInProgress = vlogs.some((vlog) => IN_PROGRESS.has(vlog.processingStatus))

  const refreshVlogs = useCallback(async () => {
    const res = await fetch('/api/vlogs')
    if (res.ok) {
      const data = await res.json()
      setVlogs(data.vlogs)
    }
  }, [])

  useEffect(() => {
    if (!anyInProgress) return
    const interval = setInterval(refreshVlogs, 5000)
    return () => clearInterval(interval)
  }, [anyInProgress, refreshVlogs])

  async function triggerProcess(vlogId: string) {
    setProcessing((prev) => ({ ...prev, [vlogId]: true }))
    setErrors((prev) => ({ ...prev, [vlogId]: '' }))
    try {
      const res = await fetch(`/api/vlogs/${vlogId}/process`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [vlogId]: formatVlogPipelineErrorMessage(data.error) ?? 'Could not start processing right now.',
        }))
      } else {
        setVlogs((prev) =>
          prev.map((vlog) =>
            vlog.id === vlogId ? { ...vlog, processingStatus: data.status ?? 'QUEUED' } : vlog,
          ),
        )
      }
    } catch {
      setErrors((prev) => ({ ...prev, [vlogId]: 'Network error' }))
    } finally {
      setProcessing((prev) => ({ ...prev, [vlogId]: false }))
    }
  }

  if (vlogs.length === 0) {
    return (
      <div className="dashboard-mirror-card p-12 text-center">
        <p className="mb-4 text-sm font-semibold tracking-[0.3em] text-[#17332d]/58">VIDEO</p>
        <p className="mb-2 font-medium text-[#17332d]">No vlogs imported yet</p>
        <p className="dashboard-mirror-subtle mb-6 text-sm">
          Connect your YouTube channel and run a catalog scan to import your videos.
        </p>
        <a href="/dashboard/settings?tab=channels" className="btn-primary text-sm">
          Go to Settings -> Channels
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {vlogs.map((vlog) => {
        const tripKit = vlog.tripKits[0]?.tripKit ?? null
        const inProgress = IN_PROGRESS.has(vlog.processingStatus)
        const canProcess = vlog.processingStatus === 'PENDING' || vlog.processingStatus === 'FAILED'

        return (
          <div key={vlog.id} className="dashboard-mirror-card p-4">
            <div className="flex items-center gap-4">
              <div className="h-[72px] w-32 shrink-0 overflow-hidden rounded-2xl bg-[#17332d]/8">
                {vlog.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vlog.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#17332d]/42">VIDEO</div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <a
                    href={vlog.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 flex-1 text-sm font-medium text-[#17332d] hover:text-[#17332d]/76"
                  >
                    {vlog.title}
                  </a>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[vlog.processingStatus] ?? 'bg-[#17332d]/8 text-[#17332d]/76'}`}>
                    {STATUS_LABELS[vlog.processingStatus] ?? vlog.processingStatus}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  {vlog.publishedAt ? (
                    <span className="dashboard-mirror-muted text-xs">
                      {new Date(vlog.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  ) : null}
                  <span className="dashboard-mirror-muted text-xs uppercase">{vlog.platform}</span>
                </div>

                {errors[vlog.id] ? <p className="mt-1 text-xs text-red-700">{errors[vlog.id]}</p> : null}
                {!errors[vlog.id] && vlog.processingStatus === 'FAILED' && vlog.pipelineError ? (
                  <p className="mt-1 text-xs text-red-700">{formatVlogPipelineErrorMessage(vlog.pipelineError)}</p>
                ) : null}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {tripKit ? (
                  <Link
                    href={`/dashboard/kits/${tripKit.id}`}
                    className="dashboard-pill-button text-sm"
                  >
                    {tripKit.isPublished ? 'View Kit' : 'Edit Draft'}
                  </Link>
                ) : vlog.processingStatus === 'REVIEW_PENDING' ? (
                  <Link href={`/dashboard/review/${vlog.id}`} className="dashboard-pill-button text-sm">
                    Review Queue
                  </Link>
                ) : canProcess ? (
                  <button
                    onClick={() => triggerProcess(vlog.id)}
                    disabled={processing[vlog.id]}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {processing[vlog.id] ? 'Starting...' : 'Generate Kit'}
                  </button>
                ) : inProgress ? (
                  <span className="dashboard-mirror-muted text-xs">Processing...</span>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
