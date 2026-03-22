import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrips, useDeleteTrip } from '../hooks/useTrip'
import GlassCard from '../components/ui/GlassCard'
import Spinner from '../components/ui/Spinner'
import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'
import toast from 'react-hot-toast'
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
  const deleteTrip = useDeleteTrip()
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirmDelete) {
      setConfirmDelete(true)
      // Auto-cancel after 3 s if user doesn't confirm
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    try {
      await deleteTrip.mutateAsync(trip.id)
      toast.success('Trip deleted')
    } catch {
      toast.error('Failed to delete trip')
      setConfirmDelete(false)
    }
  }

  return (
    <GlassCard hoverable padding="md" onClick={() => navigate(`/trips/${trip.id}`)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-white">{trip.name}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={statusColors[trip.status] ?? 'badge'}>{trip.status}</span>
          {trip.status === 'planning' && (
            <button
              onClick={handleDelete}
              disabled={deleteTrip.isPending}
              title={confirmDelete ? 'Click again to confirm' : 'Delete trip'}
              className={`p-1 rounded-lg transition-all text-xs ${
                confirmDelete
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 px-2'
                  : 'text-white/30 hover:text-red-400 hover:bg-red-500/10'
              }`}
            >
              {confirmDelete ? '⚠️ Confirm?' : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          )}
        </div>
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
