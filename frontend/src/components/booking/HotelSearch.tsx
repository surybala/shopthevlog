import { useState } from 'react'
import { useHotelSearch } from '../../hooks/useHotelSearch'
import { useBookingStore } from '../../stores/bookingStore'
import GlassInput from '../ui/GlassInput'
import GlassButton from '../ui/GlassButton'
import type { HotelOffer } from '../../types/booking'

export default function HotelSearch() {
  const search = useHotelSearch()
  const { selectHotel, setHotelParams } = useBookingStore((s) => ({
    selectHotel: s.selectHotel,
    setHotelParams: s.setHotelParams,
  }))

  // Read pre-populated params set by ItineraryPanel when the drawer opened.
  // useState reads store once at mount — fine because HotelSearch unmounts when
  // the drawer closes and remounts fresh each time it opens.
  const storedParams = useBookingStore((s) => s.hotelParams)
  const destinationLabel = useBookingStore((s) => s.destinationLabel)

  const [form, setForm] = useState({
    location: storedParams?.location ?? '',
    check_in: storedParams?.check_in ?? '',
    check_out: storedParams?.check_out ?? '',
    guests: storedParams?.guests ?? 1,
    rooms: storedParams?.rooms ?? 1,
  })

  /** Update local form state AND sync back to the store so "Save & Close" captures the latest values. */
  function updateForm(updates: Partial<typeof form>) {
    setForm((f) => {
      const next = { ...f, ...updates }
      setHotelParams(next)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    search.mutate({ ...form, guests: Number(form.guests), rooms: Number(form.rooms) })
  }

  return (
    <div className="space-y-5">
      {/* Auto-populated hint */}
      {destinationLabel && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-500/10 border border-brand-500/20">
          <span className="text-brand-400 text-sm">✨</span>
          <p className="text-white/70 text-xs">
            Pre-filled for <span className="text-white font-medium">{destinationLabel}</span> based on your itinerary.
            Adjust any field below.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <GlassInput
          label="Destination"
          placeholder="Tokyo, Japan"
          value={form.location}
          onChange={(e) => updateForm({ location: e.target.value })}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Check-in"
            type="date"
            value={form.check_in}
            onChange={(e) => updateForm({ check_in: e.target.value })}
            required
          />
          <GlassInput
            label="Check-out"
            type="date"
            value={form.check_out}
            onChange={(e) => updateForm({ check_out: e.target.value })}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Guests"
            type="number"
            min={1}
            max={20}
            value={form.guests}
            onChange={(e) => updateForm({ guests: Number(e.target.value) })}
          />
          <GlassInput
            label="Rooms"
            type="number"
            min={1}
            max={10}
            value={form.rooms}
            onChange={(e) => updateForm({ rooms: Number(e.target.value) })}
          />
        </div>

        <GlassButton type="submit" loading={search.isPending} fullWidth>
          Search Hotels
        </GlassButton>
      </form>

      {/* Results */}
      {search.data && (
        <div className="space-y-3">
          <p className="text-white/50 text-sm">{search.data.length} properties found</p>
          {(search.data as HotelOffer[]).map((offer) => (
            <button
              key={offer.id}
              onClick={() => selectHotel(offer)}
              className="w-full glass-hover p-4 text-left"
            >
              <div className="flex gap-3">
                {offer.accommodation.photos[0] && (
                  <img
                    src={offer.accommodation.photos[0].url}
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                    alt={offer.accommodation.name}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-white text-sm leading-snug">
                      {offer.accommodation.name}
                    </span>
                    <span className="text-brand-300 font-bold text-sm flex-shrink-0">
                      {offer.cheapest_rate_currency} {parseFloat(offer.cheapest_rate_total_amount).toLocaleString()}
                    </span>
                  </div>
                  {offer.accommodation.rating && (
                    <div className="flex items-center gap-1 mt-1">
                      {'★'.repeat(Math.round(offer.accommodation.rating))}
                      <span className="text-white/40 text-xs">{'☆'.repeat(5 - Math.round(offer.accommodation.rating))}</span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {search.isError && (
        <p className="text-red-400 text-sm">{(search.error as Error).message}</p>
      )}
    </div>
  )
}
