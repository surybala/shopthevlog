'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buildImportedVlogInsight, type ProcessingInsight } from '@/lib/vlogInsights'
import { formatVlogPipelineErrorMessage, getVlogProcessingPresentation } from '@/lib/vlogProcessing'

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
  opportunities?: {
    reviewState?: string
    publishState?: string
    opportunityType?: string
  }[]
}

type CatalogVideo = {
  videoId: string
  title: string
  description: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  imported: boolean
  importedVlogId: string | null
  importedProcessingStatus: string | null
  insights?: ProcessingInsight
}

interface Props {
  initialVlogs: Vlog[]
  youtubeConnected: boolean
  remainingVlogSlots: number
}

const IN_PROGRESS = new Set([
  'QUEUED',
  'TRANSCRIBING',
  'TRANSCRIPT_DONE',
  'EXTRACTING',
  'VISION_DONE',
  'FUSED',
  'RESOLVED',
  'RANKED',
  'EMBEDDING',
])

function insightChipClasses(tone: ProcessingInsight['chips'][number]['tone']) {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/14 text-emerald-950'
    case 'amber':
      return 'bg-amber-500/16 text-amber-950'
    case 'rose':
      return 'bg-rose-500/16 text-rose-950'
    default:
      return 'bg-[#17332d]/8 text-[#17332d]/76'
  }
}

export default function VlogsClient({ initialVlogs, youtubeConnected, remainingVlogSlots }: Props) {
  const router = useRouter()
  const [vlogs, setVlogs] = useState<Vlog[]>(initialVlogs)
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showImportModal, setShowImportModal] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [importing, setImporting] = useState(false)
  const [catalogVideos, setCatalogVideos] = useState<CatalogVideo[]>([])
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])
  const [availableSlots, setAvailableSlots] = useState(remainingVlogSlots)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [showImportedInCatalog, setShowImportedInCatalog] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [urlLookupLoading, setUrlLookupLoading] = useState(false)
  const [catalogReconnectRequired, setCatalogReconnectRequired] = useState(false)
  const [importLimitReached, setImportLimitReached] = useState(false)
  const [pipelineStaleWarning, setPipelineStaleWarning] = useState(false)

  const anyInProgress = vlogs.some((vlog) => IN_PROGRESS.has(vlog.processingStatus))
  const recommendedImportedVlogs = useMemo(
    () =>
      vlogs
        .map((vlog) => ({ vlog, insight: buildImportedVlogInsight(vlog) }))
        .filter(({ vlog }) => ['PENDING', 'FAILED'].includes(vlog.processingStatus))
        .sort((left, right) => right.insight.score - left.insight.score)
        .slice(0, 2),
    [vlogs],
  )

  useEffect(() => {
    setVlogs(initialVlogs)
  }, [initialVlogs])

  useEffect(() => {
    setAvailableSlots(remainingVlogSlots)
  }, [remainingVlogSlots])

  const refreshVlogs = useCallback(async () => {
    const res = await fetch('/api/vlogs')
    if (res.ok) {
      const data = await res.json()
      setVlogs(data.vlogs)
    }
  }, [])

  const loadCatalog = useCallback(async (query = '', showImported = false) => {
    setCatalogLoading(true)
    setCatalogError('')
    setCatalogReconnectRequired(false)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('query', query.trim())
      if (showImported) params.set('showImported', 'true')
      const res = await fetch(`/api/creator/scan/preview${params.toString() ? `?${params.toString()}` : ''}`)
      const data = await res.json()
      if (!res.ok) {
        setCatalogError(data.error ?? 'Could not load your YouTube videos right now.')
        setCatalogReconnectRequired(Boolean(data.reconnectRequired))
        return
      }
      setCatalogVideos(data.videos)
      setAvailableSlots(data.remainingVlogSlots)
    } catch {
      setCatalogError('Network error')
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!anyInProgress) {
      setPipelineStaleWarning(false)
      return
    }
    // After 5 minutes of continuous in-progress polling, show a stale warning.
    // This catches vlogs that are stuck due to backend issues.
    const STALE_AFTER_MS = 5 * 60 * 1000
    const staleTimeout = setTimeout(() => setPipelineStaleWarning(true), STALE_AFTER_MS)
    const interval = setInterval(refreshVlogs, 5000)
    return () => {
      clearInterval(interval)
      clearTimeout(staleTimeout)
    }
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

  async function deleteVlog(vlogId: string) {
    setDeleting((prev) => ({ ...prev, [vlogId]: true }))
    setErrors((prev) => ({ ...prev, [vlogId]: '' }))
    try {
      const res = await fetch(`/api/vlogs/${vlogId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [vlogId]:
            data.error ??
            'This video could not be deleted because it still has linked Trip Kit content or related records.',
        }))
        return
      }
      setVlogs((prev) => prev.filter((vlog) => vlog.id !== vlogId))
      setAvailableSlots((prev) => prev + 1)
      router.refresh()
    } catch {
      setErrors((prev) => ({ ...prev, [vlogId]: 'Network error' }))
    } finally {
      setDeleting((prev) => ({ ...prev, [vlogId]: false }))
    }
  }

  async function openImportModal() {
    setShowImportModal(true)
    setSelectedVideoIds([])
    setCatalogQuery('')
    setShowImportedInCatalog(false)
    setVideoUrl('')
    setImportLimitReached(false)
    await loadCatalog('', false)
  }

  async function importSelectedVideos() {
    if (selectedVideoIds.length === 0) return
    setImporting(true)
    setCatalogError('')
    setCatalogReconnectRequired(false)
    setImportLimitReached(false)
    try {
      const res = await fetch('/api/creator/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds: selectedVideoIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCatalogError(data.error ?? 'Could not import those videos right now.')
        setCatalogReconnectRequired(Boolean(data.reconnectRequired))
        return
      }
      await refreshVlogs()
      if (data.limitReached) {
        // Keep modal open so the user can see the warning
        setImportLimitReached(true)
        setSelectedVideoIds([])
        await loadCatalog(catalogQuery, showImportedInCatalog)
      } else {
        setShowImportModal(false)
        setSelectedVideoIds([])
        setVideoUrl('')
      }
      router.refresh()
    } catch {
      setCatalogError('Network error')
    } finally {
      setImporting(false)
    }
  }

  const selectableVideos = useMemo(
    () => catalogVideos.filter((video) => !video.imported),
    [catalogVideos],
  )

  useEffect(() => {
    if (!showImportModal) return
    const timeout = setTimeout(() => {
      void loadCatalog(catalogQuery, showImportedInCatalog)
    }, 250)
    return () => clearTimeout(timeout)
  }, [catalogQuery, showImportedInCatalog, showImportModal, loadCatalog])

  function toggleSelected(videoId: string) {
    setSelectedVideoIds((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : prev.length >= availableSlots
          ? prev
          : [...prev, videoId],
    )
  }

  async function lookupVideoUrl() {
    if (!videoUrl.trim()) return
    setUrlLookupLoading(true)
    setCatalogError('')
    setCatalogReconnectRequired(false)
    try {
      const res = await fetch('/api/creator/scan/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCatalogError(data.error ?? 'Could not find that video right now.')
        setCatalogReconnectRequired(Boolean(data.reconnectRequired))
        return
      }
      if (data.video?.videoId) {
        setCatalogVideos([data.video])
        setAvailableSlots(data.remainingVlogSlots)
        setSelectedVideoIds(data.video.imported ? [] : [data.video.videoId])
      }
    } catch {
      setCatalogError('Network error')
    } finally {
      setUrlLookupLoading(false)
    }
  }

  async function reconnectYouTube() {
    const res = await fetch('/api/auth/youtube')
    const data = await res.json().catch(() => ({}))
    if (data.url) {
      window.location.href = data.url
    } else {
      setCatalogError('Could not start YouTube reconnect right now.')
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="dashboard-mirror-subtle text-sm">
          Choose which videos you want to import and generate kits from. Deleting a video frees a slot, but does not refund processing credits.
        </p>
        {youtubeConnected ? (
          <button onClick={openImportModal} className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none" disabled={remainingVlogSlots <= 0 && availableSlots <= 0}>
            Import specific videos
          </button>
        ) : null}
      </div>

      {pipelineStaleWarning ? (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
          One or more videos have been processing for over 5 minutes. This may indicate a pipeline issue.{' '}
          <button onClick={refreshVlogs} className="underline underline-offset-2">Refresh status</button>
          {' '}or contact support if the issue persists.
        </div>
      ) : null}

      {recommendedImportedVlogs.length > 0 ? (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {recommendedImportedVlogs.map(({ vlog, insight }) => (
            <div key={vlog.id} className="dashboard-mirror-card p-4">
              <p className="dashboard-mirror-kicker text-[11px]">Suggested next</p>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#17332d]">{vlog.title}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-[rgba(23,51,45,0.52)]">
                {insight.primaryFit}
              </p>
              <p className="mt-2 text-sm text-[rgba(23,51,45,0.68)]">{insight.headline}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-[rgba(23,51,45,0.08)] px-2.5 py-1 text-xs font-medium text-[#17332d]">
                  {insight.recommendation}
                </span>
                <span className="rounded-full bg-[rgba(23,51,45,0.06)] px-2.5 py-1 text-xs text-[rgba(23,51,45,0.72)]">
                  Score {insight.score}
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-[rgba(23,51,45,0.6)]">
                {insight.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {vlogs.length === 0 ? (
        <div className="dashboard-mirror-card p-12 text-center">
          <p className="mb-4 text-sm font-semibold tracking-[0.3em] text-[#17332d]/58">VIDEO</p>
          <p className="mb-2 font-medium text-[#17332d]">No vlogs imported yet</p>
          <p className="dashboard-mirror-subtle mb-6 text-sm">
            Connect your YouTube channel and import the videos you want to turn into Trip Kits.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="/dashboard/settings?tab=channels" className="btn-ghost text-sm">
              Go to Settings -&gt; Channels
            </a>
            {youtubeConnected ? (
              <button onClick={openImportModal} className="btn-primary text-sm">
                Import videos
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {vlogs.map((vlog) => {
            const tripKit = vlog.tripKits[0]?.tripKit ?? null
            const statusPresentation = getVlogProcessingPresentation(vlog.processingStatus)
            const inProgress = statusPresentation.inProgress || IN_PROGRESS.has(vlog.processingStatus)
            const canProcess = vlog.processingStatus === 'PENDING' || vlog.processingStatus === 'FAILED'
            const insight = buildImportedVlogInsight(vlog)

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
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusPresentation.tone}`}>
                        {statusPresentation.label}
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
                    {!errors[vlog.id] ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgba(23,51,45,0.52)]">
                          {insight.primaryFit}
                        </p>
                        <p className="text-sm text-[rgba(23,51,45,0.68)]">{insight.headline}</p>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-[rgba(23,51,45,0.08)] px-2.5 py-1 text-xs font-medium text-[#17332d]">
                            {insight.recommendation}
                          </span>
                          {insight.chips.map((chip) => (
                            <span key={chip.label} className={`rounded-full px-2.5 py-1 text-xs ${insightChipClasses(chip.tone)}`}>
                              {chip.label}
                            </span>
                          ))}
                        </div>
                        <ul className="space-y-1 text-xs text-[rgba(23,51,45,0.6)]">
                          {insight.reasons.map((reason) => (
                            <li key={reason}>• {reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {tripKit ? (
                      <Link href={`/dashboard/kits/${tripKit.id}`} className="dashboard-action-chip text-sm">
                        {tripKit.isPublished ? 'View Kit' : 'Edit Draft'}
                      </Link>
                    ) : vlog.processingStatus === 'REVIEW_PENDING' ? (
                      <Link href={`/dashboard/review/${vlog.id}`} className="dashboard-action-chip text-sm">
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

                    <button
                      onClick={() => deleteVlog(vlog.id)}
                      disabled={deleting[vlog.id]}
                      className="dashboard-action-chip text-sm"
                    >
                      {deleting[vlog.id] ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showImportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02140f]/70 px-5 backdrop-blur-sm">
          <div className="max-h-[84vh] w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[rgba(23,51,45,0.12)] bg-[rgba(255,248,240,0.97)] shadow-[0_40px_160px_rgba(0,0,0,0.25)]">
            <div className="flex items-center justify-between border-b border-[rgba(23,51,45,0.1)] px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-[#17332d]">Import videos from YouTube</h3>
                <p className="mt-1 text-sm text-[rgba(23,51,45,0.62)]">
                  Select up to {availableSlots} more video{availableSlots === 1 ? '' : 's'} to add to your library.
                </p>
              </div>
              <button type="button" onClick={() => setShowImportModal(false)} className="dashboard-pill-button px-4 py-2 text-sm text-[#17332d]">
                Close
              </button>
            </div>

            <div className="max-h-[calc(84vh-148px)] overflow-y-auto p-6">
              {importLimitReached ? (
                <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
                  You&apos;ve reached your video import limit. Some of the selected videos were skipped.
                  Upgrade to PRO for a higher limit, or delete existing videos to free up slots.
                </div>
              ) : null}

              <div className="mb-5 grid gap-3 rounded-[1.4rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.68)] p-4 lg:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <div>
                    <label className="dashboard-mirror-kicker mb-1.5 block text-[11px]">Search your YouTube library</label>
                    <input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      className="dashboard-input"
                      placeholder="Search by title or description"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-[rgba(23,51,45,0.62)]">
                    <input
                      type="checkbox"
                      checked={showImportedInCatalog}
                      onChange={(event) => setShowImportedInCatalog(event.target.checked)}
                    />
                    Show already imported videos
                  </label>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="dashboard-mirror-kicker mb-1.5 block text-[11px]">Or paste a YouTube URL</label>
                    <input
                      value={videoUrl}
                      onChange={(event) => setVideoUrl(event.target.value)}
                      className="dashboard-input"
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                  </div>
                  <button
                    onClick={lookupVideoUrl}
                    disabled={urlLookupLoading || !videoUrl.trim()}
                    className="btn-ghost text-sm disabled:opacity-50"
                  >
                    {urlLookupLoading ? 'Finding video...' : 'Find this video'}
                  </button>
                </div>
              </div>

              {catalogLoading ? (
                <p className="text-sm text-[rgba(23,51,45,0.62)]">Loading your YouTube videos...</p>
              ) : catalogError ? (
                <div className="space-y-3">
                  <p className="text-sm text-red-700">{catalogError}</p>
                  {catalogReconnectRequired ? (
                    <button onClick={reconnectYouTube} className="btn-ghost text-sm">
                      Reconnect YouTube
                    </button>
                  ) : null}
                </div>
              ) : selectableVideos.length === 0 ? (
                <p className="text-sm text-[rgba(23,51,45,0.62)]">No importable videos found right now.</p>
              ) : (
                <div className="space-y-3">
                  {catalogVideos.map((video) => {
                    const checked = selectedVideoIds.includes(video.videoId)
                    const disabled = video.imported || (!checked && selectedVideoIds.length >= availableSlots)
                    return (
                      <label
                        key={video.videoId}
                        className={`flex items-center gap-4 rounded-[1.4rem] border p-4 transition-colors ${
                          video.imported
                            ? 'border-[rgba(23,51,45,0.08)] bg-[rgba(23,51,45,0.04)]'
                            : checked
                              ? 'border-[rgba(23,51,45,0.2)] bg-[rgba(23,51,45,0.08)]'
                              : 'border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.72)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSelected(video.videoId)}
                        />
                        <div className="h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-[#17332d]/8">
                          {video.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium text-[#17332d]">{video.title}</p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-[rgba(23,51,45,0.52)]">
                            {video.publishedAt ? (
                              <span>
                                {new Date(video.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            ) : null}
                            {video.imported ? <span>Already imported</span> : null}
                            {video.importedProcessingStatus ? <span>{getVlogProcessingPresentation(video.importedProcessingStatus).label}</span> : null}
                          </div>
                          {video.insights ? (
                            <div className="mt-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgba(23,51,45,0.52)]">
                                {video.insights.primaryFit}
                              </p>
                              <p className="text-sm text-[rgba(23,51,45,0.68)]">{video.insights.headline}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="rounded-full bg-[rgba(23,51,45,0.08)] px-2.5 py-1 text-xs font-medium text-[#17332d]">
                                  {video.insights.recommendation}
                                </span>
                                <span className="rounded-full bg-[rgba(23,51,45,0.06)] px-2.5 py-1 text-xs text-[rgba(23,51,45,0.72)]">
                                  Score {video.insights.score}
                                </span>
                                {video.insights.chips.map((chip) => (
                                  <span key={chip.label} className={`rounded-full px-2.5 py-1 text-xs ${insightChipClasses(chip.tone)}`}>
                                    {chip.label}
                                  </span>
                                ))}
                              </div>
                              <ul className="mt-2 space-y-1 text-xs text-[rgba(23,51,45,0.6)]">
                                {video.insights.reasons.map((reason) => (
                                  <li key={reason}>• {reason}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[rgba(23,51,45,0.1)] px-6 py-4">
              <p className="text-sm text-[rgba(23,51,45,0.62)]">
                {selectedVideoIds.length} selected
              </p>
              <button
                onClick={importSelectedVideos}
                disabled={importing || selectedVideoIds.length === 0}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import selected videos'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
