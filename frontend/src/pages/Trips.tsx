import { useNavigate } from 'react-router-dom'
import { useTrips } from '../hooks/useTrip'
import GlassCard from '../components/ui/GlassCard'
import Spinner from '../components/ui/Spinner'
import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'
import type { Trip } from '../types/booking'

const statusColors: Record<string, string> = {
  planning:  'badge',
  booked:    'badge-green',
  completed: 'badge',
  cancelled: 'bg-white/10 text-white/40 rounded-full text-xs px-2.5 py-1',
}

function TripCard({ trip }: { trip: Trip }) {
  const navigate = useNavigate()
  const openBooking = useBookingStore((s) => s.open)

  return (
    <GlassCard hoverable padding="md" onClick={() => navigate(`/trips/${trip.id}`)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-white">{trip.name}</h3>
        <span className={statusColors[trip.status] ?? 'badge'}>{trip.status}</span>
      </div>
      {(trip.start_date || trip.end_date) && (
        <p className="text-white/60 text-sm mb-3">
          📅 {trip.start_date ?? '?'} → {trip.end_date ?? '?'}
        </p>
      )}
      <p className="text-white/40 text-sm">👥 {trip.traveller_count} traveller{trip.traveller_count !== 1 ? 's' : ''}</p>
      {trip.status === 'planning' && (
        <button
          onClick={(e) => { e.stopPropagation(); openBooking(trip.id) }}
          className="mt-4 btn-primary text-sm py-2 px-4"
        >
          ✈️ Book flights & hotels
        </button>
      )}
    </GlassCard>
  )
}

export default function Trips() {
  const { data: trips, isLoading } = useTrips()

  const planning  = trips?.filter((t) => t.status === 'planning')  ?? []
  const booked    = trips?.filter((t) => t.status === 'booked')    ?? []
  const completed = trips?.filter((t) => t.status === 'completed') ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-white mb-8">My Trips</h1>

      {isLoading && (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      )}

      {!isLoading && (!trips || trips.length === 0) && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">✈️</div>
          <h3 className="text-white text-lg font-semibold mb-2">No trips yet</h3>
          <p className="text-white/50 text-sm">Find a vlog you love and start planning.</p>
        </div>
      )}

      {planning.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">Planning</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {planning.map((t) => <TripCard key={t.id} trip={t} />)}
          </div>
        </section>
      )}

      {booked.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">Booked</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {booked.map((t) => <TripCard key={t.id} trip={t} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">Completed</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {completed.map((t) => <TripCard key={t.id} trip={t} />)}
          </div>
        </section>
      )}

      <BookingDrawer />
    </div>
  )
}
