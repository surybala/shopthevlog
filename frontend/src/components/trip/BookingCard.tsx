/**
 * BookingCard — rich display card for a single flight or hotel booking.
 * Shows confirmation details, schedule/dates, passengers, price, and
 * Cancel / Modify actions.
 */
import { useState } from 'react'
import type { Booking, FlightBookingMeta, HotelBookingMeta } from '../../types/booking'
import GlassModal from '../ui/GlassModal'
import GlassButton from '../ui/GlassButton'
import Spinner from '../ui/Spinner'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtPrice(amount: number | null, currency: string): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null
  try {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime()
    return Math.round(diff / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null
  const full = Math.floor(rating)
  return (
    <span className="text-yellow-400 text-xs" aria-label={`${rating} stars`}>
      {'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}
    </span>
  )
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  pending:   'bg-yellow-500/20  text-yellow-400  border-yellow-500/30',
  cancelled: 'bg-red-500/20     text-red-400     border-red-500/30',
  failed:    'bg-red-500/20     text-red-400     border-red-500/30',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-white/40 text-xs uppercase tracking-wide shrink-0 pt-0.5">{label}</span>
      <span className="text-white/90 text-sm text-right">{value}</span>
    </div>
  )
}

function FlightDetails({ meta }: { meta: FlightBookingMeta }) {
  if (!meta.slices?.length) {
    return (
      <DetailRow
        label="Route"
        value={meta.origin && meta.destination ? `${meta.origin} → ${meta.destination}` : '—'}
      />
    )
  }
  return (
    <>
      {meta.slices.map((s, i) => (
        <div key={i} className="py-2 border-b border-white/[0.06] last:border-0 space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-white/40 text-xs uppercase tracking-wide">
              {meta.slices.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : 'Flight'}
            </span>
            {s.airline && <span className="text-white/60 text-xs">{s.airline}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">{s.origin ?? '—'}</span>
            <span className="text-white/30 text-xs">→</span>
            <span className="text-white font-semibold text-sm">{s.destination ?? '—'}</span>
          </div>
          {s.departing_at && (
            <p className="text-white/50 text-xs">{fmtDateTime(s.departing_at)}</p>
          )}
          {s.arriving_at && (
            <p className="text-white/50 text-xs">Arrives {fmtDateTime(s.arriving_at)}</p>
          )}
        </div>
      ))}
    </>
  )
}

function HotelDetails({ meta }: { meta: HotelBookingMeta }) {
  const nights = nightsBetween(meta.check_in, meta.check_out)
  return (
    <>
      {meta.hotel_name && (
        <div className="py-2 border-b border-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-semibold text-sm">{meta.hotel_name}</span>
            <StarRating rating={meta.hotel_rating} />
          </div>
          {meta.hotel_address && (
            <p className="text-white/40 text-xs mt-0.5">{meta.hotel_address}</p>
          )}
        </div>
      )}
      <DetailRow
        label="Check-in"
        value={fmtDate(meta.check_in)}
      />
      <DetailRow
        label="Check-out"
        value={
          <>
            {fmtDate(meta.check_out)}
            {nights != null && (
              <span className="text-white/40 ml-1">({nights} night{nights !== 1 ? 's' : ''})</span>
            )}
          </>
        }
      />
    </>
  )
}

// ─── BookingCard ──────────────────────────────────────────────────────────────

interface BookingCardProps {
  booking: Booking
  onCancel: (id: string) => Promise<void>
  onAddBooking?: () => void
}

export default function BookingCard({ booking, onCancel, onAddBooking }: BookingCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const isFlight = booking.booking_type === 'flight'
  const icon = isFlight ? '✈️' : '🏨'
  const typeLabel = isFlight ? 'Flight' : 'Hotel stay'

  const flightMeta = isFlight ? (booking.search_params as FlightBookingMeta | null) : null
  const hotelMeta  = !isFlight ? (booking.search_params as HotelBookingMeta | null) : null

  const canCancel = booking.status === 'confirmed' || booking.status === 'pending'

  async function handleCancel() {
    setCancelling(true)
    try {
      await onCancel(booking.id)
    } finally {
      setCancelling(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      {/* ── Cancel confirm modal ── */}
      <GlassModal
        isOpen={confirmOpen}
        onClose={() => !cancelling && setConfirmOpen(false)}
        title={`Cancel ${typeLabel}?`}
        size="sm"
      >
        <p className="text-white/60 text-sm mb-5">
          {isFlight
            ? 'This will cancel your flight reservation. Refunds depend on the fare conditions.'
            : 'This will cancel your hotel reservation. Please check the cancellation policy with the property.'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={cancelling}
            className="flex-1 glass px-4 py-2 rounded-xl text-white/60 hover:text-white text-sm transition-colors"
          >
            Keep booking
          </button>
          <GlassButton
            onClick={handleCancel}
            loading={cancelling}
            size="sm"
            className="flex-1 !bg-red-500/20 hover:!bg-red-500/30 border-red-500/30"
          >
            Yes, cancel
          </GlassButton>
        </div>
      </GlassModal>

      {/* ── Card ── */}
      <div
        className="glass rounded-2xl overflow-hidden"
        data-testid={`booking-card-${booking.id}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <span className="text-2xl" role="img" aria-label={typeLabel}>{icon}</span>
            <div>
              <p className="text-white font-semibold text-sm">{typeLabel}</p>
              {booking.provider && (
                <p className="text-white/30 text-xs capitalize">{booking.provider}</p>
              )}
            </div>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_STYLES[booking.status] ?? STATUS_STYLES.pending}`}
            data-testid="booking-status-badge"
          >
            {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
          </span>
        </div>

        {/* Body */}
        <div className="px-5 py-3">
          {/* Confirmation reference */}
          {booking.duffel_booking_reference && (
            <DetailRow
              label="Confirmation"
              value={
                <span className="font-mono tracking-widest font-bold" data-testid="booking-reference">
                  {booking.duffel_booking_reference}
                </span>
              }
            />
          )}

          {/* Flight-specific details */}
          {isFlight && flightMeta && <FlightDetails meta={flightMeta} />}

          {/* Hotel-specific details */}
          {!isFlight && hotelMeta && <HotelDetails meta={hotelMeta} />}

          {/* Passengers / guests */}
          {booking.passenger_details && booking.passenger_details.length > 0 && (
            <DetailRow
              label={isFlight ? 'Passengers' : 'Guests'}
              value={
                <span className="space-y-0.5 block text-right">
                  {booking.passenger_details.map((p, i) => (
                    <span key={i} className="block">
                      {p.given_name} {p.family_name}
                    </span>
                  ))}
                </span>
              }
            />
          )}

          {/* Price */}
          <DetailRow
            label="Total"
            value={
              <span className="text-emerald-400 font-bold" data-testid="booking-total">
                {fmtPrice(booking.total_amount, booking.currency)}
              </span>
            }
          />

          {/* Booked date */}
          <DetailRow label="Booked" value={fmtDate(booking.booked_at)} />
        </div>

        {/* Actions footer — only shown for active bookings */}
        {booking.status !== 'cancelled' && booking.status !== 'failed' && (
          <div className="flex gap-2 px-5 py-3 border-t border-white/[0.07]">
            {onAddBooking && (
              <button
                onClick={onAddBooking}
                className="flex-1 glass px-3 py-2 rounded-xl text-white/60 hover:text-white text-xs transition-colors"
                data-testid="booking-modify-btn"
              >
                ＋ Add booking
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setConfirmOpen(true)}
                className="flex-1 glass px-3 py-2 rounded-xl text-red-400/80 hover:text-red-400 text-xs transition-colors"
                data-testid="booking-cancel-btn"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
