import { useSearchParams, useNavigate } from 'react-router-dom'
import GlassCard from '../components/ui/GlassCard'
import GlassButton from '../components/ui/GlassButton'
import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'

export default function BookingConfirmation() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ref = params.get('ref')
  const type = params.get('type') ?? 'flight'
  const tripId = params.get('trip_id')

  const { hotelParams, destinationLabel, reset, open } = useBookingStore()

  function handleBookHotel() {
    if (!tripId) return
    open(tripId, 'hotels', null, hotelParams, destinationLabel)
  }

  function handleDone() {
    reset()
    navigate('/trips')
  }

  const isFlightConfirmation = type === 'flight'

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <GlassCard className="max-w-md w-full text-center py-12">
        {/* Icon */}
        <div className="text-6xl mb-4 animate-float">
          {isFlightConfirmation ? '✈️' : '🏨'}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-white mb-2">
          {isFlightConfirmation ? 'Flight Booked!' : 'Hotel Booked!'}
        </h1>
        <p className="text-white/60 mb-6">
          Your {type} has been confirmed successfully.
        </p>

        {/* Booking reference */}
        {ref && (
          <div className="glass rounded-xl p-3 mb-6">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Booking reference</p>
            <p className="font-mono font-bold text-white text-lg tracking-widest">{ref}</p>
          </div>
        )}

        {/* Flight confirmed → offer hotel booking */}
        {isFlightConfirmation ? (
          <div className="space-y-3">
            <div className="glass rounded-xl p-4 mb-1">
              <p className="text-white/70 text-sm font-medium">🏨 Want to add a hotel?</p>
              {destinationLabel && (
                <p className="text-white/40 text-xs mt-1">
                  We'll search accommodation in {destinationLabel}
                </p>
              )}
            </div>
            <GlassButton onClick={handleBookHotel} fullWidth>
              🏨 Book a Hotel
            </GlassButton>
            <button
              onClick={handleDone}
              className="w-full text-white/50 hover:text-white text-sm py-2 transition-colors"
            >
              Skip → View My Trips
            </button>
          </div>
        ) : (
          /* Hotel confirmed → done */
          <GlassButton onClick={handleDone} fullWidth>
            🗺️ View My Trips
          </GlassButton>
        )}
      </GlassCard>

      {/* Drawer lives here so hotel can be booked right from this page */}
      <BookingDrawer />
    </div>
  )
}
