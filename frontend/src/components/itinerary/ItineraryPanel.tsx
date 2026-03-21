import { motion } from 'framer-motion'
import { useItinerary } from '../../hooks/useItinerary'
import { useVlogStatus } from '../../hooks/useVlog'
import { useCreateTrip } from '../../hooks/useTrip'
import { useBookingStore } from '../../stores/bookingStore'
import DayBlock from './DayBlock'
import Spinner from '../ui/Spinner'
import GlassButton from '../ui/GlassButton'
import toast from 'react-hot-toast'

interface ItineraryPanelProps {
  vlogId: string
  initialStatus: string
  initialItineraryId: string | null
}

const statusMessages: Record<string, { icon: string; text: string }> = {
  pending:      { icon: '⏳', text: 'Queued for processing…' },
  transcribing: { icon: '🎙️', text: 'Transcribing audio…' },
  planning:     { icon: '🗺️', text: 'Claude is building your itinerary…' },
  failed:       { icon: '❌', text: 'Processing failed. Try regenerating.' },
}

export default function ItineraryPanel({ vlogId, initialStatus, initialItineraryId }: ItineraryPanelProps) {
  const isProcessing = initialStatus !== 'ready' && initialStatus !== 'failed'

  const { data: status } = useVlogStatus(vlogId, isProcessing)
  const currentStatus = status?.status ?? initialStatus
  const itineraryId = status?.itinerary_id ?? initialItineraryId

  const { data: itinerary, isLoading } = useItinerary(
    currentStatus === 'ready' ? itineraryId : null
  )

  const createTrip = useCreateTrip()
  const openBooking = useBookingStore((s) => s.open)

  async function handleSaveTrip() {
    if (!itinerary) return
    try {
      const { data: trip } = await createTrip.mutateAsync({
        itinerary_id: itinerary.id,
        vlog_id: vlogId,
        name: itinerary.title,
      })
      toast.success('Trip saved!')
      openBooking(trip.id)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save trip')
    }
  }

  // Still processing
  if (currentStatus !== 'ready' && currentStatus !== 'failed') {
    const msg = statusMessages[currentStatus] ?? statusMessages.pending
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="text-4xl animate-float">{msg.icon}</span>
        <p className="text-white/70">{msg.text}</p>
        <Spinner size="sm" />
      </div>
    )
  }

  if (currentStatus === 'failed') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="text-4xl">❌</span>
        <p className="text-white/70">Could not generate itinerary for this vlog.</p>
      </div>
    )
  }

  if (isLoading || !itinerary) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="p-6 border-b border-white/10 flex-shrink-0">
        <h2 className="font-bold text-white text-lg leading-snug">{itinerary.title}</h2>
        {itinerary.summary && (
          <p className="text-white/60 text-sm mt-1">{itinerary.summary}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          {itinerary.total_days && (
            <span className="badge">📅 {itinerary.total_days} days</span>
          )}
          {itinerary.destinations.slice(0, 3).map((d) => (
            <span key={d} className="badge">📍 {d}</span>
          ))}
          {itinerary.estimated_budget_usd && (
            <span className="badge-green">~${itinerary.estimated_budget_usd.toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Days */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {itinerary.days.map((day, i) => (
          <DayBlock key={day.id} day={day} defaultOpen={i === 0} />
        ))}
      </div>

      {/* CTA */}
      <div className="p-6 border-t border-white/10 flex-shrink-0 space-y-2">
        <GlassButton
          onClick={handleSaveTrip}
          loading={createTrip.isPending}
          fullWidth
          className="text-sm"
        >
          ✈️ Plan & Book This Trip
        </GlassButton>
      </div>
    </motion.div>
  )
}
