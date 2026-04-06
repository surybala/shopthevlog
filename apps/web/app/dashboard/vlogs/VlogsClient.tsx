'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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
  processedAt: string | null
  tripKits: { tripKit: TripKitRef }[]
}

interface Props {
  initialVlogs: Vlog[]
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:     'bg-white/10 text-white/40',
  QUEUED:      'bg-blue-500/20 text-blue-400',
  TRANSCRIBING:'bg-yellow-500/20 text-yellow-400 animate-pulse',
  EXTRACTING:  'bg-purple-500/20 text-purple-400 animate-pulse',
  EMBEDDING:   'bg-orange-500/20 text-orange-400 animate-pulse',
  COMPLETE:    'bg-green-500/20 text-green-400',
  FAILED:      'bg-red-500/20 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING:     'Pending',
  QUEUED:      'Queued',
  TRANSCRIBING:'Transcribing…',
  EXTRACTING:  'Generating Kit…',
  EMBEDDING:   'Embedding…',
  COMPLETE:    'Complete',
  FAILED:      'Failed',
}

const IN_PROGRESS = new Set(['QUEUED', 'TRANSCRIBING', 'EXTRACTING', 'EMBEDDING'])

export default function VlogsClient({ initialVlogs }: Props) {
  const [vlogs, setVlogs] = useState<Vlog[]>(initialVlogs)
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Poll for status updates on any vlog that's in-progress
  const anyInProgress = vlogs.some(v => IN_PROGRESS.has(v.processingStatus))

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
    setProcessing(p => ({ ...p, [vlogId]: true }))
    setErrors(e => ({ ...e, [vlogId]: '' }))
    try {
      const res = await fetch(`/api/vlogs/${vlogId}/process`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setErrors(e => ({ ...e, [vlogId]: data.error ?? 'Failed to start processing' }))
      } else {
        // Optimistically update status
        setVlogs(prev => prev.map(v =>
          v.id === vlogId ? { ...v, processingStatus: data.status ?? 'QUEUED' } : v
        ))
      }
    } catch {
      setErrors(e => ({ ...e, [vlogId]: 'Network error' }))
    } finally {
      setProcessing(p => ({ ...p, [vlogId]: false }))
    }
  }

  if (vlogs.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="text-4xl mb-4">🎬</p>
        <p className="text-white font-medium mb-2">No vlogs imported yet</p>
        <p className="text-white/40 text-sm mb-6">
          Connect your YouTube channel and run a catalog scan to import your videos.
        </p>
        <a href="/dashboard/settings?tab=channels" className="btn-primary text-sm">
          Go to Settings → Channels
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {vlogs.map(vlog => {
        const tripKit = vlog.tripKits[0]?.tripKit ?? null
        const inProgress = IN_PROGRESS.has(vlog.processingStatus)
        const canProcess = vlog.processingStatus === 'PENDING' || vlog.processingStatus === 'FAILED'

        return (
          <div key={vlog.id} className="glass-card p-4">
            <div className="flex items-center gap-4">
              {/* Thumbnail */}
              <div className="shrink-0 w-32 h-[72px] rounded-lg overflow-hidden bg-white/5">
                {vlog.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vlog.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20 text-2xl">▶</div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <a
                    href={vlog.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-white hover:text-white/80 line-clamp-2 flex-1"
                  >
                    {vlog.title}
                  </a>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[vlog.processingStatus] ?? 'bg-white/10 text-white/40'}`}>
                    {STATUS_LABELS[vlog.processingStatus] ?? vlog.processingStatus}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  {vlog.publishedAt && (
                    <span className="text-xs text-white/30">
                      {new Date(vlog.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  <span className="text-xs text-white/30 uppercase">{vlog.platform}</span>
                </div>

                {errors[vlog.id] && (
                  <p className="text-xs text-red-400 mt-1">{errors[vlog.id]}</p>
                )}
              </div>

              {/* Actions */}
              <div className="shrink-0 flex items-center gap-2">
                {tripKit ? (
                  <Link
                    href={`/dashboard/kits/${tripKit.id}`}
                    className="text-sm px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                  >
                    {tripKit.isPublished ? '🗺 View Kit' : '✏️ Edit Draft'}
                  </Link>
                ) : canProcess ? (
                  <button
                    onClick={() => triggerProcess(vlog.id)}
                    disabled={processing[vlog.id]}
                    className="text-sm px-3 py-1.5 rounded-lg bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50 transition-colors"
                  >
                    {processing[vlog.id] ? 'Starting…' : '✨ Generate Kit'}
                  </button>
                ) : inProgress ? (
                  <span className="text-xs text-white/30">Processing…</span>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
