/**
 * FlightDetailSheet — slide-out panel showing full flight offer details.
 * Opens when a user clicks a flight card in FlightSearch instead of immediately
 * selecting the offer. The "Select this flight" CTA commits the selection.
 */
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassButton from '../ui/GlassButton'
import type { FlightOffer } from '../../types/booking'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(iso: string): string {
  const match = iso.match(/PT(\d+H)?(\d+M)?/)
  if (!match) return iso
  const h = match[1] ? parseInt(match[1]) : 0
  const m = match[2] ? parseInt(match[2]) : 0
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ')
}

function msBetween(from: string, to: string): number {
  return new Date(to).getTime() - new Date(from).getTime()
}

function msToLabel(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m'
}

function fmtTime(dt: string): string {
  return new Date(dt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function fmtDate(dt: string): string {
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function expiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  return msToLabel(ms)
}

const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First Class',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface FlightDetailSheetProps {
  offer: FlightOffer | null
  /** Cabin class from the search form — display-only, not returned by API on the offer. */
  cabinClass?: string
  onClose: () => void
  onSelect: (offer: FlightOffer) => void
}

export default function FlightDetailSheet({
  offer,
  cabinClass,
  onClose,
  onSelect,
}: FlightDetailSheetProps) {
  const cabinLabel = cabinClass ? (CABIN_LABELS[cabinClass] ?? cabinClass) : null

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
            data-testid="flight-detail-backdrop"
          />

          {/* Sheet */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-70 flex flex-col glass border-l border-white/10"
            style={{ width: 'min(780px, 90vw)', borderRadius: '24px 0 0 24px' }}
            data-testid="flight-detail-sheet"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-white/10 flex-shrink-0">
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-3 mb-2">
                  {offer.owner.logo_symbol_url && (
                    <img
                      src={offer.owner.logo_symbol_url}
                      className="w-8 h-8 object-contain"
                      alt={offer.owner.name}
                    />
                  )}
                  <h2 className="font-bold text-white text-xl">{offer.owner.name}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-white font-bold text-2xl">
                    {offer.total_currency}{' '}
                    {parseFloat(offer.total_amount).toLocaleString()}
                  </span>
                  {cabinLabel && (
                    <span className="badge">{cabinLabel}</span>
                  )}
                  <span className="text-white/40 text-sm">
                    · expires in {expiresIn(offer.expires_at)}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white transition-colors flex-shrink-0 mt-1"
                aria-label="Close"
                data-testid="flight-detail-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Slices — scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {offer.slices.map((slice, si) => (
                <div key={si} className="space-y-3">
                  {/* Slice header */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-base">
                      {slice.origin.iata_code} → {slice.destination.iata_code}
                    </span>
                    {slice.origin.name && (
                      <span className="text-white/40 text-xs">
                        ({slice.origin.name} → {slice.destination.name})
                      </span>
                    )}
                    <span className="ml-auto text-white/60 text-sm font-medium">
                      {formatDuration(slice.duration)}
                    </span>
                    <span className="text-white/35 text-xs">
                      {slice.segments.length} segment{slice.segments.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Segments + layover pills */}
                  <div className="space-y-2">
                    {slice.segments.map((seg, gi) => (
                      <div key={gi}>
                        {/* Segment card */}
                        <div className="rounded-xl bg-white/[0.05] border border-white/10 p-4">
                          {/* Carrier + aircraft */}
                          <div className="flex items-center gap-2 mb-3">
                            {seg.operating_carrier.logo_symbol_url && (
                              <img
                                src={seg.operating_carrier.logo_symbol_url}
                                className="w-5 h-5 object-contain"
                                alt={seg.operating_carrier.name}
                              />
                            )}
                            <span className="text-white/80 text-sm font-medium">
                              {seg.operating_carrier.name}
                            </span>
                            {seg.aircraft && (
                              <span className="text-white/40 text-xs ml-auto">
                                ✈ {seg.aircraft.name}
                              </span>
                            )}
                          </div>

                          {/* Times + route */}
                          <div className="flex items-center justify-between">
                            {/* Departure */}
                            <div className="text-center min-w-[60px]">
                              <p className="text-white font-bold text-xl leading-none">
                                {fmtTime(seg.departing_at)}
                              </p>
                              <p className="text-white/45 text-xs mt-0.5">{fmtDate(seg.departing_at)}</p>
                              <p className="text-white/70 text-sm font-semibold mt-1">
                                {seg.origin.iata_code}
                              </p>
                            </div>

                            {/* Duration arrow */}
                            <div className="flex-1 px-3 flex flex-col items-center gap-1">
                              <span className="text-white/35 text-xs">
                                {msToLabel(msBetween(seg.departing_at, seg.arriving_at))}
                              </span>
                              <div className="w-full flex items-center gap-1">
                                <div className="flex-1 h-px bg-white/15" />
                                <span className="text-white/40 text-xs">✈</span>
                                <div className="flex-1 h-px bg-white/15" />
                              </div>
                            </div>

                            {/* Arrival */}
                            <div className="text-center min-w-[60px]">
                              <p className="text-white font-bold text-xl leading-none">
                                {fmtTime(seg.arriving_at)}
                              </p>
                              <p className="text-white/45 text-xs mt-0.5">{fmtDate(seg.arriving_at)}</p>
                              <p className="text-white/70 text-sm font-semibold mt-1">
                                {seg.destination.iata_code}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Layover pill between segments */}
                        {gi < slice.segments.length - 1 && (
                          <div className="flex items-center justify-center py-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                              <span className="text-amber-400 text-xs">⏱</span>
                              <span className="text-amber-300 text-xs font-medium">
                                {msToLabel(
                                  msBetween(seg.arriving_at, slice.segments[gi + 1].departing_at)
                                )}{' '}
                                layover in {slice.segments[gi + 1].origin.iata_code}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer CTA */}
            <div className="p-6 border-t border-white/10 flex-shrink-0">
              <GlassButton onClick={() => onSelect(offer)} fullWidth data-testid="flight-select-btn">
                Select this flight →
              </GlassButton>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
