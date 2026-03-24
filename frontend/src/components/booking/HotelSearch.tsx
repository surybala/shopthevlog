import { useState } from 'react'
import { useHotelSearch } from '../../hooks/useHotelSearch'
import { useBookingStore } from '../../stores/bookingStore'
import GlassInput from '../ui/GlassInput'
import GlassButton from '../ui/GlassButton'
import HotelResultsPanel from './HotelResultsPanel'
import type { HotelOffer } from '../../types/booking'

export default function HotelSearch() {
  const search = useHotelSearch()
  const { selectHotel, setHotelParams } = useBookingStore((s) => ({
    selectHotel: s.selectHotel,
    setHotelParams: s.setHotelParams,
  }))

  // Read pre-populated params set by ItineraryPanel when the drawer opened.
  const storedParams = useBookingStore((s) => s.hotelParams)
  const destinationLabel = useBookingStore((s) => s.destinationLabel)

  const [form, setForm] = useState({
    location: storedParams?.location ?? '',
    check_in: storedParams?.check_in ?? '',
    check_out: storedParams?.check_out ?? '',
    guests: storedParams?.guests ?? 1,
    rooms: storedParams?.rooms ?? 1,
  })

  /**
   * Whether the full-screen results panel is visible.
   * Automatically opens when search succeeds; closes when user clicks "Modify search".
   */
  const [panelOpen, setPanelOpen] = useState(false)

  /** Update local form state AND sync back to the store. */
  function updateForm(updates: Partial<typeof form>) {
    setForm((f) => {
      const next = { ...f, ...updates }
      setHotelParams(next)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Close any stale panel from a previous search
    setPanelOpen(false)
    search.mutate(
      { ...form, guests: Number(form.guests), rooms: Number(form.rooms) },
      {
        onSuccess: () => setPanelOpen(true),
      }
    )
  }

  const results = search.data as HotelOffer[] | undefined

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

      {/* "View results" shortcut if panel was closed manually */}
      {results && results.length > 0 && !panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          className="w-full glass rounded-xl py-3 text-sm text-white/60 hover:text-white transition-colors"
        >
          🏨 View {results.length} results →
        </button>
      )}

      {search.isError && (
        <p className="text-red-400 text-sm">{(search.error as Error).message}</p>
      )}

      {/* Full-screen results panel — renders via portal above the drawer */}
      {results && results.length > 0 && panelOpen && (
        <HotelResultsPanel
          offers={results}
          checkIn={form.check_in}
          checkOut={form.check_out}
          onClose={() => setPanelOpen(false)}
          onSelect={(offer) => {
            setPanelOpen(false)
            selectHotel(offer)
          }}
        />
      )}
    </div>
  )
}
