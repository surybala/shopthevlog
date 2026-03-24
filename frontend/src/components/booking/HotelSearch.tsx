import { useState } from 'react'
import { useHotelSearch } from '../../hooks/useHotelSearch'
import { useBookingStore } from '../../stores/bookingStore'
import GlassInput from '../ui/GlassInput'
import GlassButton from '../ui/GlassButton'
import HotelDetailSheet from './HotelDetailSheet'
import type { HotelOffer } from '../../types/booking'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeNights(checkIn: string, checkOut: string): number | null {
  if (!checkIn || !checkOut) return null
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  const n = Math.round(diff / (1000 * 60 * 60 * 24))
  return n > 0 ? n : null
}

function fmtPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Star rating: show filled/empty stars for a 1–5 scale
function StarRatingRow({ rating }: { rating: number | null }) {
  if (!rating) return null
  const full = Math.min(Math.floor(Number(rating)), 5)
  const empty = Math.max(0, 5 - full)
  return (
    <span className="text-yellow-400 text-xs" aria-label={`${full} star hotel`}>
      {'★'.repeat(full)}{'☆'.repeat(empty)}
    </span>
  )
}

// ─── Hotel result card ────────────────────────────────────────────────────────

interface HotelCardProps {
  offer: HotelOffer
  nights: number | null
  onClick: () => void
}

function HotelCard({ offer, nights, onClick }: HotelCardProps) {
  const [imgIdx, setImgIdx] = useState(0)
  const photos = offer.accommodation.photos
  const total = parseFloat(offer.cheapest_rate_total_amount)
  const perNight = nights && nights > 0 ? Math.round(total / nights) : null

  return (
    <button
      onClick={onClick}
      className="w-full text-left glass rounded-2xl overflow-hidden transition-all hover:bg-white/[0.07] active:scale-[0.99]"
      data-testid={`hotel-card-${offer.id}`}
    >
      <div className="flex min-h-[156px]">
        {/* ── Photo column ── */}
        <div className="relative w-36 flex-shrink-0 bg-white/[0.04]">
          {photos.length > 0 ? (
            <img
              src={photos[imgIdx]?.url ?? photos[0].url}
              alt={offer.accommodation.name}
              className="w-full h-full object-cover"
              style={{ minHeight: 156 }}
            />
          ) : (
            <div className="w-full flex items-center justify-center" style={{ minHeight: 156 }}>
              <span className="text-3xl opacity-20">🏨</span>
            </div>
          )}

          {/* Photo carousel dots */}
          {photos.length > 1 && (
            <div
              className="absolute bottom-0 left-0 right-0 flex justify-center gap-1 pb-1.5 bg-gradient-to-t from-black/50 to-transparent pt-4"
              onClick={(e) => e.stopPropagation()}
            >
              {photos.slice(0, Math.min(photos.length, 5)).map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setImgIdx(i) }}
                  className={`rounded-full transition-all ${
                    i === imgIdx
                      ? 'w-3 h-1.5 bg-white'
                      : 'w-1.5 h-1.5 bg-white/50'
                  }`}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Photo count badge */}
          {photos.length > 5 && (
            <div className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-1.5 py-0.5 rounded-full">
              +{photos.length - 5}
            </div>
          )}
        </div>

        {/* ── Info column ── */}
        <div className="flex-1 min-w-0 flex flex-col p-3">
          {/* Hotel name */}
          <h3 className="text-white font-semibold text-sm leading-snug line-clamp-2">
            {offer.accommodation.name}
          </h3>

          {/* Address / neighbourhood */}
          {offer.accommodation.address && (
            <p className="text-white/45 text-xs mt-0.5 truncate">
              📍 {offer.accommodation.address}
            </p>
          )}

          {/* Rating row: score badge + stars + provider */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {offer.accommodation.rating != null && (
              <>
                {/* Score badge (Kayak-style green box) */}
                <span className="bg-emerald-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded leading-none">
                  {Number(offer.accommodation.rating).toFixed(1)}
                </span>
                <StarRatingRow rating={offer.accommodation.rating} />
              </>
            )}
            {/* Provider chip */}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                offer.provider === 'liteapi'
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                  : 'bg-white/[0.07] text-white/35 border-white/10'
              }`}
            >
              {offer.provider === 'liteapi' ? 'LiteAPI' : 'Duffel'}
            </span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* ── Price row ── */}
          <div className="mt-2 pt-2 border-t border-white/[0.07] flex items-end justify-between gap-2">
            <div>
              {perNight ? (
                <>
                  <div className="flex items-baseline gap-1">
                    <span className="text-white font-bold text-base">
                      {fmtPrice(perNight, offer.cheapest_rate_currency)}
                    </span>
                    <span className="text-white/40 text-[11px]">/night</span>
                  </div>
                  <p className="text-white/40 text-[11px]">
                    {fmtPrice(total, offer.cheapest_rate_currency)} total · {nights} night{nights !== 1 ? 's' : ''}
                  </p>
                </>
              ) : (
                <span className="text-white font-bold text-base">
                  {fmtPrice(total, offer.cheapest_rate_currency)}
                </span>
              )}
            </div>
            <span className="text-emerald-400 text-xs font-medium whitespace-nowrap">
              View details →
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  /** Offer currently shown in the detail sheet; null = sheet closed. */
  const [detailOffer, setDetailOffer] = useState<HotelOffer | null>(null)

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

  const nights = computeNights(form.check_in, form.check_out)
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

      {/* ── Results ── */}
      {results && (
        <div className="space-y-3">
          {/* Results header */}
          <div className="flex items-center justify-between">
            <p className="text-white/50 text-sm font-medium">
              {results.length} propert{results.length === 1 ? 'y' : 'ies'} found
            </p>
            {nights && form.check_in && form.check_out && (
              <p className="text-white/35 text-xs">
                {fmtDate(form.check_in)} – {fmtDate(form.check_out)} · {nights} night{nights !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {results.map((offer) => (
            <HotelCard
              key={offer.id}
              offer={offer}
              nights={nights}
              onClick={() => setDetailOffer(offer)}
            />
          ))}
        </div>
      )}

      {search.isError && (
        <p className="text-red-400 text-sm">{(search.error as Error).message}</p>
      )}

      {/* Hotel detail sheet */}
      <HotelDetailSheet
        offer={detailOffer}
        checkIn={form.check_in}
        checkOut={form.check_out}
        onClose={() => setDetailOffer(null)}
        onSelect={(offer) => {
          selectHotel(offer)
          setDetailOffer(null)
        }}
      />
    </div>
  )
}
