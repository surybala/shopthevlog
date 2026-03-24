/**
 * HotelResultsPanel — full-screen hotel search results overlay.
 *
 * Renders via a portal at z-[55] (above the booking drawer at z-50) so the
 * user doesn't have to scroll inside the narrow drawer to browse hotels.
 *
 * Layout:
 *   ┌─ Header ─────────────────────────────────────────────────────────────┐
 *   │ ← Modify search   🏨 N properties   May 1 – May 5 · 4 nights        │
 *   └──────────────────────────────────────────────────────────────────────┘
 *   ┌─ Sidebar (240px) ─┐ ┌─ Card grid (flex-1) ──────────────────────────┐
 *   │ Sort by            │ │ [Card] [Card]                                  │
 *   │ Price range        │ │ [Card] [Card]                                  │
 *   │ Hotel class (★)   │ │  …                                             │
 *   │ Provider           │ │                                                │
 *   └────────────────────┘ └────────────────────────────────────────────────┘
 *
 * Clicking a card opens HotelDetailSheet (existing, z-60+) on top.
 */
import { createPortal } from 'react-dom'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import HotelDetailSheet from './HotelDetailSheet'
import type { HotelOffer } from '../../types/booking'

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'default' | 'price_asc' | 'price_desc' | 'rating_desc'

interface Filters {
  sort: SortKey
  maxPrice: number        // 0 = no cap
  minStars: number        // 0 = any
  provider: 'all' | 'liteapi' | 'duffel'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtDate(iso: string): string {
  // Parse as local date (not UTC) so '2024-05-01' always renders as "May 1".
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function computeNights(checkIn: string, checkOut: string): number | null {
  if (!checkIn || !checkOut) return null
  const n = Math.round(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
  )
  return n > 0 ? n : null
}

// ─── Inline hotel card (self-contained, no photo carousel state leak) ─────────

function PanelHotelCard({
  offer,
  nights,
  onClick,
}: {
  offer: HotelOffer
  nights: number | null
  onClick: () => void
}) {
  const [imgIdx, setImgIdx] = useState(0)
  const photos = offer.accommodation.photos
  const total = parseFloat(offer.cheapest_rate_total_amount)
  const perNight = nights && nights > 0 ? Math.round(total / nights) : null

  return (
    <button
      onClick={onClick}
      data-testid={`hotel-card-${offer.id}`}
      className="w-full text-left glass rounded-2xl overflow-hidden transition-all hover:bg-white/[0.08] active:scale-[0.99]"
    >
      {/* Photo */}
      <div className="relative bg-white/[0.04] h-40 w-full">
        {photos.length > 0 ? (
          <img
            src={photos[imgIdx]?.url ?? photos[0].url}
            alt={offer.accommodation.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl opacity-20">🏨</span>
          </div>
        )}

        {/* Carousel dots */}
        {photos.length > 1 && (
          <div
            className="absolute bottom-0 left-0 right-0 flex justify-center gap-1 pb-2 bg-gradient-to-t from-black/60 to-transparent pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            {photos.slice(0, Math.min(photos.length, 5)).map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setImgIdx(i) }}
                className={`rounded-full transition-all ${
                  i === imgIdx ? 'w-3 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'
                }`}
              />
            ))}
          </div>
        )}

        {/* Provider chip on photo */}
        <span
          className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full border font-medium backdrop-blur-sm ${
            offer.provider === 'liteapi'
              ? 'bg-sky-500/20 text-sky-300 border-sky-400/30'
              : 'bg-white/10 text-white/50 border-white/20'
          }`}
        >
          {offer.provider === 'liteapi' ? 'LiteAPI' : 'Duffel'}
        </span>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <h3 className="text-white font-semibold text-sm leading-snug line-clamp-2">
          {offer.accommodation.name}
        </h3>

        {offer.accommodation.address && (
          <p className="text-white/40 text-xs truncate">📍 {offer.accommodation.address}</p>
        )}

        {/* Stars + score */}
        {offer.accommodation.rating != null && (
          <div className="flex items-center gap-1.5">
            <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">
              {Number(offer.accommodation.rating).toFixed(1)}
            </span>
            <span className="text-yellow-400 text-xs">
              {'★'.repeat(Math.min(Math.floor(Number(offer.accommodation.rating)), 5))}
              {'☆'.repeat(Math.max(0, 5 - Math.min(Math.floor(Number(offer.accommodation.rating)), 5)))}
            </span>
          </div>
        )}

        {/* Price */}
        <div className="pt-1 border-t border-white/[0.07] flex items-end justify-between">
          <div>
            {perNight ? (
              <>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-white font-bold text-base">
                    {fmtPrice(perNight, offer.cheapest_rate_currency)}
                  </span>
                  <span className="text-white/40 text-[10px]">/night</span>
                </div>
                <p className="text-white/40 text-[10px]">
                  {fmtPrice(total, offer.cheapest_rate_currency)} total
                </p>
              </>
            ) : (
              <span className="text-white font-bold text-sm">
                {fmtPrice(total, offer.cheapest_rate_currency)}
              </span>
            )}
          </div>
          <span className="text-emerald-400 text-xs font-medium">View →</span>
        </div>
      </div>
    </button>
  )
}

// ─── Filter sidebar section wrapper ──────────────────────────────────────────

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <p className="text-white/50 text-xs uppercase tracking-widest font-medium">{title}</p>
      {children}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface HotelResultsPanelProps {
  offers: HotelOffer[]
  checkIn: string
  checkOut: string
  onClose: () => void
  onSelect: (offer: HotelOffer) => void
}

export default function HotelResultsPanel({
  offers,
  checkIn,
  checkOut,
  onClose,
  onSelect,
}: HotelResultsPanelProps) {
  const nights = computeNights(checkIn, checkOut)

  // Infer currency from first offer (all should be same)
  const currency = offers[0]?.cheapest_rate_currency ?? 'USD'

  // Compute price bounds from the live result set
  const prices = offers.map((o) => parseFloat(o.cheapest_rate_total_amount))
  const minPrice = prices.length ? Math.min(...prices) : 0
  const rawMax = prices.length ? Math.max(...prices) : 1000
  // Round up to a clean ceiling
  const ceilMax = Math.ceil(rawMax / 50) * 50

  const [filters, setFilters] = useState<Filters>({
    sort: 'default',
    maxPrice: ceilMax,
    minStars: 0,
    provider: 'all',
  })

  const [detailOffer, setDetailOffer] = useState<HotelOffer | null>(null)

  // Check if any non-default filter is active
  const hasActiveFilters =
    filters.sort !== 'default' ||
    filters.maxPrice < ceilMax ||
    filters.minStars > 0 ||
    filters.provider !== 'all'

  function resetFilters() {
    setFilters({ sort: 'default', maxPrice: ceilMax, minStars: 0, provider: 'all' })
  }

  // Apply filters + sort
  const filtered = useMemo(() => {
    let result = [...offers]

    if (filters.provider !== 'all') {
      result = result.filter((o) => o.provider === filters.provider)
    }
    if (filters.minStars > 0) {
      result = result.filter(
        (o) => o.accommodation.rating != null && Number(o.accommodation.rating) >= filters.minStars
      )
    }
    if (filters.maxPrice < ceilMax) {
      result = result.filter(
        (o) => parseFloat(o.cheapest_rate_total_amount) <= filters.maxPrice
      )
    }

    if (filters.sort === 'price_asc') {
      result.sort(
        (a, b) => parseFloat(a.cheapest_rate_total_amount) - parseFloat(b.cheapest_rate_total_amount)
      )
    } else if (filters.sort === 'price_desc') {
      result.sort(
        (a, b) => parseFloat(b.cheapest_rate_total_amount) - parseFloat(a.cheapest_rate_total_amount)
      )
    } else if (filters.sort === 'rating_desc') {
      result.sort(
        (a, b) => (Number(b.accommodation.rating) ?? 0) - (Number(a.accommodation.rating) ?? 0)
      )
    }

    return result
  }, [offers, filters, ceilMax])

  const panel = (
    <AnimatePresence>
      <motion.div
        key="hotel-results-panel"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[55] flex flex-col"
        style={{ background: 'rgba(8, 8, 20, 0.97)', backdropFilter: 'blur(24px)' }}
        data-testid="hotel-results-panel"
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Modify search
            </button>
            <div className="h-4 w-px bg-white/20" />
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-sm">
                🏨 {filtered.length}
                {filtered.length !== offers.length && (
                  <span className="text-white/40"> of {offers.length}</span>
                )}{' '}
                {filtered.length === 1 ? 'property' : 'properties'}
              </span>
              {hasActiveFilters && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                  Filtered
                </span>
              )}
            </div>
          </div>

          {/* Date range */}
          {checkIn && checkOut && (
            <p className="text-white/40 text-xs hidden sm:block">
              {fmtDate(checkIn)} – {fmtDate(checkOut)}
              {nights ? ` · ${nights} night${nights !== 1 ? 's' : ''}` : ''}
            </p>
          )}
        </div>

        {/* ── Body: sidebar + grid ───────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Filter sidebar */}
          <aside className="w-56 flex-shrink-0 border-r border-white/10 overflow-y-auto py-5 px-4 space-y-6 hidden md:block">

            {/* Sort */}
            <FilterSection title="Sort by">
              {(
                [
                  { key: 'default',     label: 'Recommended' },
                  { key: 'price_asc',   label: 'Price: low to high' },
                  { key: 'price_desc',  label: 'Price: high to low' },
                  { key: 'rating_desc', label: 'Star rating' },
                ] as { key: SortKey; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilters((f) => ({ ...f, sort: key }))}
                  className={`flex items-center gap-2 w-full text-left text-sm rounded-lg px-2.5 py-2 transition-colors ${
                    filters.sort === key
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                      filters.sort === key ? 'bg-emerald-400 border-emerald-400' : 'border-white/30'
                    }`}
                  />
                  {label}
                </button>
              ))}
            </FilterSection>

            {/* Max price */}
            <FilterSection title="Max price (total stay)">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-white/40">
                  <span>{fmtPrice(minPrice, currency)}</span>
                  <span className="text-white font-medium">{fmtPrice(filters.maxPrice, currency)}</span>
                </div>
                <input
                  type="range"
                  min={minPrice}
                  max={ceilMax}
                  step={Math.max(10, Math.round((ceilMax - minPrice) / 20))}
                  value={filters.maxPrice}
                  onChange={(e) => setFilters((f) => ({ ...f, maxPrice: Number(e.target.value) }))}
                  className="w-full accent-emerald-400 h-1 rounded-full"
                />
                {filters.maxPrice < ceilMax && (
                  <p className="text-white/40 text-xs">
                    {filtered.length} of {offers.length} shown
                  </p>
                )}
              </div>
            </FilterSection>

            {/* Star class */}
            <FilterSection title="Hotel class">
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 2, 3, 4, 5].map((stars) => (
                  <button
                    key={stars}
                    data-testid={`filter-stars-${stars}`}
                    onClick={() => setFilters((f) => ({ ...f, minStars: stars }))}
                    className={`text-xs rounded-lg py-1.5 px-1 border transition-all text-center ${
                      filters.minStars === stars
                        ? 'bg-white/15 border-white/40 text-white'
                        : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                    }`}
                  >
                    {stars === 0 ? 'Any' : `${stars}★+`}
                  </button>
                ))}
              </div>
            </FilterSection>

            {/* Provider */}
            <FilterSection title="Provider">
              <div className="space-y-1">
                {(
                  [
                    { key: 'all',     label: 'All providers' },
                    { key: 'liteapi', label: 'LiteAPI' },
                    { key: 'duffel',  label: 'Duffel' },
                  ] as { key: Filters['provider']; label: string }[]
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    data-testid={`filter-provider-${key}`}
                    onClick={() => setFilters((f) => ({ ...f, provider: key }))}
                    className={`flex items-center gap-2 w-full text-left text-sm rounded-lg px-2.5 py-2 transition-colors ${
                      filters.provider === key
                        ? 'bg-white/10 text-white'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    <span
                      className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                        filters.provider === key
                          ? 'bg-emerald-400 border-emerald-400'
                          : 'border-white/30'
                      }`}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </FilterSection>

            {/* Reset */}
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="w-full text-center text-xs text-white/40 hover:text-red-400 py-1.5 transition-colors"
              >
                ✕ Clear all filters
              </button>
            )}
          </aside>

          {/* ── Hotel card grid ──────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto py-5 px-4 md:px-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
                <span className="text-4xl opacity-30">🔍</span>
                <p className="text-white/50 text-sm">No properties match your filters.</p>
                <button
                  onClick={resetFilters}
                  className="text-emerald-400 text-sm hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((offer) => (
                  <PanelHotelCard
                    key={offer.id}
                    offer={offer}
                    nights={nights}
                    onClick={() => setDetailOffer(offer)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

        {/* Mobile filter bar (shown below md) */}
        <div className="md:hidden flex-shrink-0 border-t border-white/10 px-4 py-2 overflow-x-auto flex gap-2">
          {/* Sort chip */}
          <select
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortKey }))}
            className="glass-input text-xs py-1 px-2 rounded-lg flex-shrink-0"
          >
            <option value="default">Recommended</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
            <option value="rating_desc">Rating ★</option>
          </select>
          {/* Stars chip */}
          {[0, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => setFilters((f) => ({ ...f, minStars: s }))}
              className={`text-xs px-3 py-1 rounded-full border flex-shrink-0 transition-all ${
                filters.minStars === s
                  ? 'bg-white/15 border-white/40 text-white'
                  : 'border-white/15 text-white/40'
              }`}
            >
              {s === 0 ? 'Any ★' : `${s}★+`}
            </button>
          ))}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs px-3 py-1 rounded-full border border-red-400/30 text-red-400 flex-shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )

  return (
    <>
      {createPortal(panel, document.body)}

      {/* HotelDetailSheet opens above the panel (z-60+) */}
      <HotelDetailSheet
        offer={detailOffer}
        checkIn={checkIn}
        checkOut={checkOut}
        onClose={() => setDetailOffer(null)}
        onSelect={(offer) => {
          setDetailOffer(null)
          onSelect(offer)
        }}
      />
    </>
  )
}
