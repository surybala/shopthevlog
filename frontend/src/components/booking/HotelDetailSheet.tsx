/**
 * HotelDetailSheet — slide-out panel showing full hotel offer details.
 * Opens when a user clicks a hotel card in HotelSearch instead of immediately
 * selecting the offer. The "Select this hotel" CTA commits the selection.
 */
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassButton from '../ui/GlassButton'
import type { HotelOffer } from '../../types/booking'

// ─── Component ────────────────────────────────────────────────────────────────

interface HotelDetailSheetProps {
  offer: HotelOffer | null
  /** Check-in date string (ISO) shown for context. */
  checkIn?: string
  /** Check-out date string (ISO) shown for context. */
  checkOut?: string
  onClose: () => void
  onSelect: (offer: HotelOffer) => void
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null
  const full = Math.min(Math.round(Number(rating)), 5)
  return (
    <span className="text-yellow-400 text-sm" aria-label={`${full} stars`}>
      {'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}
    </span>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function HotelDetailSheet({
  offer,
  checkIn,
  checkOut,
  onClose,
  onSelect,
}: HotelDetailSheetProps) {
  const photos = offer?.accommodation.photos ?? []

  return createPortal(
    <AnimatePresence>
      {offer && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-60"
            data-testid="hotel-detail-backdrop"
          />

          {/* Sheet */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-70 flex flex-col glass border-l border-white/10"
            style={{ width: 'min(780px, 90vw)', borderRadius: '24px 0 0 24px' }}
            data-testid="hotel-detail-sheet"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-white/10 flex-shrink-0">
              <div className="flex-1 pr-4">
                <h2 className="font-bold text-white text-xl leading-snug">
                  {offer.accommodation.name}
                </h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <StarRating rating={offer.accommodation.rating} />
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      offer.provider === 'liteapi'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {offer.provider === 'liteapi' ? 'LiteAPI' : 'Duffel'}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white transition-colors flex-shrink-0 mt-1"
                aria-label="Close"
                data-testid="hotel-detail-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content — scrollable */}
            <div className="flex-1 overflow-y-auto">
              {/* Photo gallery */}
              {photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto px-6 pt-5 pb-3 scrollbar-thin">
                  {photos.slice(0, 10).map((photo, i) => (
                    <img
                      key={i}
                      src={photo.url}
                      alt={`${offer.accommodation.name} photo ${i + 1}`}
                      className="w-48 h-32 rounded-xl object-cover flex-shrink-0"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}

              <div className="p-6 space-y-5">
                {/* Address */}
                {offer.accommodation.address && (
                  <div className="flex items-start gap-3">
                    <span className="text-white/40 text-base mt-0.5">📍</span>
                    <div>
                      <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Location</p>
                      <p className="text-white/80 text-sm leading-relaxed">
                        {offer.accommodation.address}
                      </p>
                    </div>
                  </div>
                )}

                {/* Stay dates */}
                {(checkIn || checkOut) && (
                  <div className="flex items-start gap-3">
                    <span className="text-white/40 text-base mt-0.5">📅</span>
                    <div>
                      <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Stay</p>
                      <div className="flex items-center gap-2 text-white/80 text-sm">
                        {checkIn && <span>Check-in: <span className="text-white font-medium">{fmtDate(checkIn)}</span></span>}
                        {checkIn && checkOut && <span className="text-white/30">·</span>}
                        {checkOut && <span>Check-out: <span className="text-white font-medium">{fmtDate(checkOut)}</span></span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Rate */}
                <div className="rounded-xl bg-white/[0.05] border border-white/10 p-4">
                  <p className="text-white/50 text-xs uppercase tracking-wide mb-2">Best Available Rate</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-2xl">
                      {offer.cheapest_rate_currency}{' '}
                      {parseFloat(offer.cheapest_rate_total_amount).toLocaleString()}
                    </span>
                    <span className="text-white/40 text-sm">total</span>
                  </div>
                  <p className="text-white/35 text-xs mt-1">
                    Taxes and fees may apply at checkout
                  </p>
                </div>

                {/* Coordinates / map placeholder */}
                {offer.accommodation.location.geographic_coordinates && (
                  <div className="flex items-center gap-2 text-white/30 text-xs">
                    <span>🗺</span>
                    <span>
                      {offer.accommodation.location.geographic_coordinates.latitude.toFixed(4)},{' '}
                      {offer.accommodation.location.geographic_coordinates.longitude.toFixed(4)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer CTA */}
            <div className="p-6 border-t border-white/10 flex-shrink-0">
              <GlassButton onClick={() => onSelect(offer)} fullWidth data-testid="hotel-select-btn">
                Select this hotel →
              </GlassButton>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
