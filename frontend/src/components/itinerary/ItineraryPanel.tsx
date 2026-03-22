/**
 * ItineraryPanel — compact sidebar card shown alongside the video.
 *
 * States:
 *  • Unplanned  → wand button to trigger Claude
 *  • Building   → spinner with status text
 *  • Failed     → retry button
 *  • Ready      → summary card + "View Itinerary" button → opens ItinerarySheet
 */
import { useState } from 'react'
import { useItinerary } from '../../hooks/useItinerary'
import { useVlogStatus } from '../../hooks/useVlog'
import { useBookingStore } from '../../stores/bookingStore'
import { deriveBookingParams } from '../../lib/destinationToIata'
import { useCreateTrip } from '../../hooks/useTrip'
import ItinerarySheet from './ItinerarySheet'
import Spinner from '../ui/Spinner'
import GlassButton from '../ui/GlassButton'
import toast from 'react-hot-toast'
import api from '../../lib/api'

interface ItineraryPanelProps {
  vlogId: string
  initialStatus: string
  initialItineraryId: string | null
}

const statusMessages: Record<string, { icon: string; text: string }> = {
  pending:      { icon: '⏳', text: 'Queued for processing…' },
  transcribing: { icon: '🎙️', text: 'Transcribing audio…' },
  planning:     { icon: '🗺️', text: 'ShopTheVlog is building your itinerary…' },
}

export default function ItineraryPanel({ vlogId, initialStatus, initialItineraryId }: ItineraryPanelProps) {
  const [actionPending, setActionPending] = useState(false)
  const [planningTriggered, setPlanningTriggered] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const isPolling =
    planningTriggered ||
    (initialStatus !== 'ready' && initialStatus !== 'failed')

  const { data: status } = useVlogStatus(vlogId, isPolling)
  const currentStatus = status?.status ?? initialStatus
  const itineraryId = status?.itinerary_id ?? initialItineraryId

  const isUnplanned = currentStatus === 'ready' && !itineraryId && !planningTriggered

  const { data: itinerary } = useItinerary(
    currentStatus === 'ready' && itineraryId ? itineraryId : null
  )

  const createTrip = useCreateTrip()
  const openBooking = useBookingStore((s) => s.open)

  async function handlePlan() {
    setActionPending(true)
    try {
      await api.post(`/vlogs/${vlogId}/plan`)
      setPlanningTriggered(true)
    } catch {
      toast.error('Could not start planning. Please try again.')
    } finally {
      setActionPending(false)
    }
  }

  async function handleRetry() {
    setActionPending(true)
    try {
      await api.post(`/vlogs/${vlogId}/plan`)
      setPlanningTriggered(true)
    } catch {
      toast.error('Could not retry. Please refresh the page.')
    } finally {
      setActionPending(false)
    }
  }

  // Quick-book without opening the sheet (CTA on the preview card)
  async function handleBookDirect() {
    if (!itinerary) return
    try {
      const { data: trip } = await createTrip.mutateAsync({
        itinerary_id: itinerary.id,
        vlog_id: vlogId,
        name: itinerary.title,
      })
      toast.success('Trip saved!')
      const { flightParams, hotelParams, destinationLabel } = deriveBookingParams(itinerary)
      openBooking(trip.id, 'flights', flightParams, hotelParams, destinationLabel)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save trip')
    }
  }

  // ── Unplanned ─────────────────────────────────────────────────────────────
  if (isUnplanned) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center">
        <span className="text-5xl">🪄</span>
        <div>
          <p className="text-white font-semibold text-base mb-1">Ready to plan</p>
          <p className="text-white/50 text-sm">
            Generate a day-by-day itinerary with activities,<br />
            estimated costs, and booking links.
          </p>
        </div>
        <GlassButton onClick={handlePlan} loading={actionPending} size="sm">
          🪄 Plan this vlog
        </GlassButton>
      </div>
    )
  }

  // ── Building ──────────────────────────────────────────────────────────────
  if (currentStatus !== 'ready' && currentStatus !== 'failed') {
    const msg = statusMessages[currentStatus] ?? statusMessages.pending
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl animate-float">{msg.icon}</span>
        <p className="text-white/70 text-sm">{msg.text}</p>
        <Spinner size="sm" />
      </div>
    )
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (currentStatus === 'failed') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl">❌</span>
        <p className="text-white/70 text-sm">Could not generate itinerary for this vlog.</p>
        <GlassButton onClick={handleRetry} loading={actionPending} size="sm">
          Try again
        </GlassButton>
      </div>
    )
  }

  // ── Ready — loading from cache ────────────────────────────────────────────
  if (!itinerary) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  // ── Ready — preview card ──────────────────────────────────────────────────
  return (
    <>
      <div className="h-full flex flex-col p-5 gap-4">
        {/* Summary */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-400 text-xs font-semibold uppercase tracking-wide">Itinerary ready</span>
          </div>
          <h3 className="font-bold text-white text-base leading-snug line-clamp-2">{itinerary.title}</h3>
          {itinerary.summary && (
            <p className="text-white/50 text-xs mt-1 leading-relaxed line-clamp-3">{itinerary.summary}</p>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {itinerary.total_days && (
            <span className="badge text-xs">📅 {itinerary.total_days} days</span>
          )}
          {itinerary.destinations.slice(0, 2).map((d) => (
            <span key={d} className="badge text-xs">📍 {d}</span>
          ))}
          {itinerary.estimated_budget_usd && (
            <span className="badge-green text-xs">~${itinerary.estimated_budget_usd.toLocaleString()}</span>
          )}
        </div>

        {/* Day count preview */}
        <div className="flex-1 space-y-1 overflow-hidden">
          {itinerary.days.slice(0, 4).map((day) => (
            <div key={day.id} className="flex items-center gap-2 py-1.5 border-b border-white/5">
              <span className="text-white/30 text-xs w-10 flex-shrink-0">Day {day.day_number}</span>
              <span className="text-white/70 text-xs truncate">{day.title ?? day.location}</span>
            </div>
          ))}
          {itinerary.days.length > 4 && (
            <p className="text-white/30 text-xs pt-1">+{itinerary.days.length - 4} more days…</p>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2 flex-shrink-0">
          <GlassButton onClick={() => setSheetOpen(true)} fullWidth>
            📋 View Full Itinerary
          </GlassButton>
          <GlassButton
            onClick={handleBookDirect}
            loading={createTrip.isPending}
            fullWidth
            className="text-sm opacity-80"
          >
            ✈️ Book Directly
          </GlassButton>
        </div>
      </div>

      {/* Wide slide-out sheet */}
      <ItinerarySheet
        itinerary={itinerary}
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        vlogId={vlogId}
      />
    </>
  )
}
