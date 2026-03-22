/**
 * ItinerarySheet — a wide slide-out panel that gives the user plenty of room
 * to read the day-by-day itinerary and then launch the booking drawer.
 * Triggered from the narrow sidebar preview card in VlogDetail.
 */
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useCreateTrip } from '../../hooks/useTrip'
import { useBookingStore } from '../../stores/bookingStore'
import { deriveBookingParams } from '../../lib/destinationToIata'
import DayBlock from './DayBlock'
import GlassButton from '../ui/GlassButton'
import toast from 'react-hot-toast'
import type { Itinerary } from '../../types/itinerary'

interface ItinerarySheetProps {
  itinerary: Itinerary
  isOpen: boolean
  onClose: () => void
  vlogId: string
}

export default function ItinerarySheet({ itinerary, isOpen, onClose, vlogId }: ItinerarySheetProps) {
  const createTrip = useCreateTrip()
  const openBooking = useBookingStore((s) => s.open)

  async function handleSaveTrip() {
    try {
      const { data: trip } = await createTrip.mutateAsync({
        itinerary_id: itinerary.id,
        vlog_id: vlogId,
        name: itinerary.title,
      })
      toast.success('Trip saved!')
      const { flightParams, hotelParams, destinationLabel } = deriveBookingParams(itinerary)
      onClose()
      openBooking(trip.id, 'flights', flightParams, hotelParams, destinationLabel)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save trip')
    }
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-60"
          />

          {/* Sheet */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-70 flex flex-col glass border-l border-white/10"
            style={{
              width: 'min(780px, 90vw)',
              borderRadius: '24px 0 0 24px',
            }}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-white/10 flex-shrink-0">
              <div className="flex-1 pr-4">
                <h2 className="font-bold text-white text-xl leading-snug">{itinerary.title}</h2>
                {itinerary.summary && (
                  <p className="text-white/55 text-sm mt-1 leading-relaxed">{itinerary.summary}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  {itinerary.total_days && (
                    <span className="badge">📅 {itinerary.total_days} days</span>
                  )}
                  {itinerary.destinations.map((d) => (
                    <span key={d} className="badge">📍 {d}</span>
                  ))}
                  {itinerary.estimated_budget_usd && (
                    <span className="badge-green">~${itinerary.estimated_budget_usd.toLocaleString()} est.</span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white transition-colors flex-shrink-0 mt-1"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Day blocks — scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {itinerary.days.map((day, i) => (
                <DayBlock key={day.id} day={day} defaultOpen={i === 0} />
              ))}
            </div>

            {/* Footer CTA */}
            <div className="p-6 border-t border-white/10 flex-shrink-0">
              <GlassButton
                onClick={handleSaveTrip}
                loading={createTrip.isPending}
                fullWidth
              >
                ✈️ Plan & Book This Trip
              </GlassButton>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
