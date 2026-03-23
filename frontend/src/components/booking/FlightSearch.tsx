import { useState } from 'react'
import { useFlightSearch } from '../../hooks/useFlightSearch'
import { useBookingStore } from '../../stores/bookingStore'
import GlassInput from '../ui/GlassInput'
import GlassButton from '../ui/GlassButton'
import type { FlightOffer } from '../../types/booking'

function formatDuration(iso: string) {
  const match = iso.match(/PT(\d+H)?(\d+M)?/)
  if (!match) return iso
  const h = match[1] ? parseInt(match[1]) : 0
  const m = match[2] ? parseInt(match[2]) : 0
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ')
}

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return '—'
  const d = new Date(dt)
  if (isNaN(d.getTime())) return dt
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function FlightSearch() {
  const search = useFlightSearch()
  const { selectFlight, setFlightParams } = useBookingStore((s) => ({
    selectFlight: s.selectFlight,
    setFlightParams: s.setFlightParams,
  }))

  // Read pre-populated params set by ItineraryPanel when the drawer opened.
  // useState reads store once at mount — fine because FlightSearch unmounts when
  // the drawer closes and remounts fresh each time it opens.
  const storedParams = useBookingStore((s) => s.flightParams)
  const destinationLabel = useBookingStore((s) => s.destinationLabel)

  const [form, setForm] = useState({
    origin: storedParams?.origin ?? '',
    destination: storedParams?.destination ?? '',
    departure_date: storedParams?.departure_date ?? '',
    return_date: storedParams?.return_date ?? '',
    passengers: storedParams?.passengers ?? 1,
    cabin_class: (storedParams?.cabin_class ?? 'economy') as
      'economy' | 'premium_economy' | 'business' | 'first',
  })

  /** Update local form state AND sync back to the store so "Save & Close" captures the latest values. */
  function updateForm(updates: Partial<typeof form>) {
    setForm((f) => {
      const next = { ...f, ...updates }
      setFlightParams(next)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    search.mutate({ ...form, passengers: Number(form.passengers) })
  }

  return (
    <div className="space-y-5">
      {/* Auto-populated hint */}
      {destinationLabel && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/15">
          <span className="text-white/60 text-sm">✨</span>
          <p className="text-white/70 text-xs">
            Pre-filled for <span className="text-white font-medium">{destinationLabel}</span> based on your itinerary.
            Adjust any field below.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="From"
            placeholder="JFK"
            value={form.origin}
            onChange={(e) => updateForm({ origin: e.target.value.toUpperCase() })}
            maxLength={3}
            required
          />
          <div>
            <GlassInput
              label="To"
              placeholder="CDG"
              value={form.destination}
              onChange={(e) => updateForm({ destination: e.target.value.toUpperCase() })}
              maxLength={3}
              required
            />
            {destinationLabel && form.destination && (
              <p className="text-white/40 text-xs mt-1 pl-1">{destinationLabel}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Departure"
            type="date"
            value={form.departure_date}
            onChange={(e) => updateForm({ departure_date: e.target.value })}
            required
          />
          <GlassInput
            label="Return (optional)"
            type="date"
            value={form.return_date}
            onChange={(e) => updateForm({ return_date: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Passengers"
            type="number"
            min={1}
            max={9}
            value={form.passengers}
            onChange={(e) => updateForm({ passengers: Number(e.target.value) })}
          />
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">Cabin</label>
            <select
              value={form.cabin_class}
              onChange={(e) => updateForm({ cabin_class: e.target.value as typeof form.cabin_class })}
              className="glass-input"
            >
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium Economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          </div>
        </div>

        <GlassButton type="submit" loading={search.isPending} fullWidth>
          Search Flights
        </GlassButton>
      </form>

      {/* Results */}
      {search.data && (
        <div className="space-y-3">
          <p className="text-white/50 text-sm">{search.data.length} offers found</p>
          {(search.data as FlightOffer[]).map((offer) => (
            <button
              key={offer.id}
              onClick={() => selectFlight(offer)}
              className="w-full glass-hover p-4 text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {offer.owner.logo_symbol_url && (
                    <img src={offer.owner.logo_symbol_url} className="w-5 h-5 object-contain" alt="" />
                  )}
                  <span className="text-white font-medium text-sm">{offer.owner.name}</span>
                </div>
                <span className="text-white font-bold">
                  {offer.total_currency} {parseFloat(offer.total_amount).toLocaleString()}
                </span>
              </div>
              {offer.slices.map((slice, i) => {
                // Duffel v2: departing_at lives on segments, not the slice wrapper
                const departingAt = slice.departing_at ?? slice.segments?.[0]?.departing_at
                return (
                  <div key={i} className="text-xs text-white/60 flex items-center gap-2">
                    <span>{slice.origin.iata_code}</span>
                    <span>→</span>
                    <span>{slice.destination.iata_code}</span>
                    <span className="text-white/40">·</span>
                    <span>{formatDateTime(departingAt)}</span>
                    <span className="text-white/40">·</span>
                    <span>{formatDuration(slice.duration)}</span>
                  </div>
                )
              })}
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
