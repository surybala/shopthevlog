import { useParams, useNavigate } from 'react-router-dom'
import { useTrip, useTripBookings, useCancelBooking } from '../hooks/useTrip'
import { useItinerary } from '../hooks/useItinerary'
import DayBlock from '../components/itinerary/DayBlock'
import BookingCard from '../components/trip/BookingCard'
import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'
import Spinner from '../components/ui/Spinner'
import GlassButton from '../components/ui/GlassButton'
import toast from 'react-hot-toast'
import type { Booking } from '../types/booking'

// ─── Status badge ──────────────────────────────────────────────────────────────

const TRIP_STATUS_STYLES: Record<string, string> = {
  planning:  'bg-blue-500/20   text-blue-400   border-blue-500/30',
  booked:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  completed: 'bg-purple-500/20 text-purple-400  border-purple-500/30',
  cancelled: 'bg-red-500/20    text-red-400     border-red-500/30',
}

function TripStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-full border font-medium ${TRIP_STATUS_STYLES[status] ?? TRIP_STATUS_STYLES.planning}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ─── Bookings section ─────────────────────────────────────────────────────────

interface BookingsSectionProps {
  bookings: Booking[]
  isLoading: boolean
  onCancel: (id: string) => Promise<void>
  onAddBooking: () => void
}

function BookingsSection({ bookings, isLoading, onCancel, onAddBooking }: BookingsSectionProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  const active = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'failed')
  const cancelled = bookings.filter((b) => b.status === 'cancelled' || b.status === 'failed')

  if (bookings.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center" data-testid="no-bookings-state">
        <p className="text-4xl mb-3">🗓️</p>
        <p className="text-white/60 text-sm mb-4">No bookings yet for this trip.</p>
        <GlassButton onClick={onAddBooking} size="sm">
          ✈️ Book flights or hotels
        </GlassButton>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="bookings-list">
      {active.map((booking) => (
        <BookingCard
          key={booking.id}
          booking={booking}
          onCancel={onCancel}
          onAddBooking={onAddBooking}
        />
      ))}

      {cancelled.length > 0 && (
        <details className="group">
          <summary className="text-white/30 text-xs cursor-pointer hover:text-white/50 transition-colors list-none flex items-center gap-1.5 py-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            {cancelled.length} cancelled booking{cancelled.length !== 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-3">
            {cancelled.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onCancel={onCancel}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {action}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: trip, isLoading: tripLoading } = useTrip(id!)
  const { data: itinerary, isLoading: itinLoading } = useItinerary(trip?.itinerary_id ?? null)
  const { data: bookings = [], isLoading: bookingsLoading } = useTripBookings(id!)

  const openBooking = useBookingStore((s) => s.open)
  const cancelBooking = useCancelBooking()

  if (tripLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  }
  if (!trip) {
    return <div className="text-center py-20 text-white/60">Trip not found.</div>
  }

  async function handleCancelBooking(bookingId: string) {
    try {
      await cancelBooking.mutateAsync(bookingId)
      toast.success('Booking cancelled.')
    } catch {
      toast.error('Failed to cancel booking. Please try again.')
      throw new Error('cancel failed') // re-throw so BookingCard can reset its loading state
    }
  }

  function handleAddBooking() {
    openBooking(trip!.id)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* ── Back nav ── */}
      <button
        onClick={() => navigate('/trips')}
        className="text-white/50 text-sm hover:text-white transition-colors block"
      >
        ← My Trips
      </button>

      {/* ── Trip header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{trip.name}</h1>
            <TripStatusBadge status={trip.status} />
          </div>
          {(trip.start_date || trip.end_date) && (
            <p className="text-white/60 text-sm">
              📅 {trip.start_date ?? '?'} → {trip.end_date ?? '?'}
              {' · '}
              {trip.traveller_count} traveller{trip.traveller_count !== 1 ? 's' : ''}
            </p>
          )}
          {trip.notes && (
            <p className="text-white/40 text-sm italic">{trip.notes}</p>
          )}
        </div>
        <GlassButton onClick={handleAddBooking} size="sm" data-testid="add-booking-btn">
          ✈️ Book
        </GlassButton>
      </div>

      {/* ── Bookings section ── */}
      <section aria-label="Bookings" data-testid="bookings-section">
        <SectionHeader
          title="Bookings"
          action={
            bookings.filter((b) => b.status === 'confirmed').length > 0 ? (
              <span className="text-emerald-400 text-xs font-medium">
                {bookings.filter((b) => b.status === 'confirmed').length} confirmed
              </span>
            ) : undefined
          }
        />
        <BookingsSection
          bookings={bookings}
          isLoading={bookingsLoading}
          onCancel={handleCancelBooking}
          onAddBooking={handleAddBooking}
        />
      </section>

      {/* ── Itinerary section ── */}
      <section aria-label="Itinerary" data-testid="itinerary-section">
        <SectionHeader title="Day-by-Day Itinerary" />

        {itinLoading && <Spinner />}

        {itinerary && (
          <div className="space-y-3">
            {itinerary.summary && (
              <p className="text-white/60 mb-4 leading-relaxed text-sm">{itinerary.summary}</p>
            )}
            {itinerary.days.map((day, i) => (
              <DayBlock key={day.id} day={day} defaultOpen={i === 0} />
            ))}
          </div>
        )}

        {!itinerary && !itinLoading && (
          <p className="text-white/40 text-sm text-center py-10">
            No itinerary attached to this trip yet.
          </p>
        )}
      </section>

      <BookingDrawer />
    </div>
  )
}
