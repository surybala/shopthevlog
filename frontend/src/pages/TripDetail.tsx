import { useParams, useNavigate } from 'react-router-dom'
import { useTrip } from '../hooks/useTrip'
import { useItinerary } from '../hooks/useItinerary'
import DayBlock from '../components/itinerary/DayBlock'
import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'
import Spinner from '../components/ui/Spinner'
import GlassButton from '../components/ui/GlassButton'

export default function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: trip, isLoading: tripLoading } = useTrip(id!)
  const { data: itinerary, isLoading: itinLoading } = useItinerary(trip?.itinerary_id ?? null)
  const openBooking = useBookingStore((s) => s.open)

  if (tripLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!trip) return <div className="text-center py-20 text-white/60">Trip not found.</div>

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button onClick={() => navigate('/trips')} className="text-white/50 text-sm hover:text-white transition-colors mb-6 block">
        ← My Trips
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{trip.name}</h1>
          {(trip.start_date || trip.end_date) && (
            <p className="text-white/60 text-sm mt-1">📅 {trip.start_date ?? '?'} → {trip.end_date ?? '?'} · {trip.traveller_count} traveller{trip.traveller_count !== 1 ? 's' : ''}</p>
          )}
        </div>
        <GlassButton onClick={() => openBooking(trip.id)} size="sm">
          ✈️ Book
        </GlassButton>
      </div>

      {itinLoading && <Spinner />}

      {itinerary && (
        <>
          {itinerary.summary && (
            <p className="text-white/60 mb-6 leading-relaxed">{itinerary.summary}</p>
          )}
          <div className="space-y-3">
            {itinerary.days.map((day, i) => (
              <DayBlock key={day.id} day={day} defaultOpen={i === 0} />
            ))}
          </div>
        </>
      )}

      {!itinerary && !itinLoading && (
        <p className="text-white/40 text-sm text-center py-10">No itinerary attached to this trip.</p>
      )}

      <BookingDrawer />
    </div>
  )
}
