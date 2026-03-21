import BookingDrawer from '../components/booking/BookingDrawer'
import { useBookingStore } from '../stores/bookingStore'
import { useEffect } from 'react'

export default function Booking() {
  const open = useBookingStore((s) => s.open)
  const tripId = new URLSearchParams(window.location.search).get('trip') ?? ''

  useEffect(() => {
    if (tripId) open(tripId)
  }, [tripId, open])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-4">Book Your Trip</h1>
      <p className="text-white/60">Use the booking panel to search and book flights and hotels.</p>
      <BookingDrawer />
    </div>
  )
}
