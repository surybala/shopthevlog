/**
 * HotelDetailSheet — full-screen Kayak-style hotel detail overlay.
 *
 * Layout
 * ──────
 *  ┌─ Header bar ────────────────────────────────────────────────┐
 *  │ ← Back   Hotel Name   ★★★★★   [Provider]   [9.2 reviews]   │
 *  ├─ Photo gallery (carousel + "View all X photos" grid) ───────┤
 *  ├─ Content (scrollable) ──────────────────────────────────────┤
 *  │  Address · Check-in / Check-out                             │
 *  │  ── About (HTML-rendered) ──                                │
 *  │  ── Amenities grid ──                                       │
 *  │  ── Available Rooms (with photos, beds, room amenities) ──  │
 *  │  ── Location (Google Maps embed, English) ──                │
 *  │  ── Guest Reviews (horizontal scroll) ──                    │
 *  ├─ Sticky footer CTA ─────────────────────────────────────────┤
 *  │  USD 200/night  ·  USD 800 total    [Reserve → / Select →]  │
 *  └─────────────────────────────────────────────────────────────┘
 */
import { createPortal } from 'react-dom'
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import GlassButton from '../ui/GlassButton'
import { usePrebookHotel, useHotelDetail } from '../../hooks/useHotelSearch'
import { useBookingStore } from '../../stores/bookingStore'
import { ApiError } from '../../lib/api'
import type { HotelOffer, HotelRoomType, HotelReview } from '../../types/booking'

// ─── Amenity icon map ─────────────────────────────────────────────────────────

const AMENITY_MAP: Record<string, { icon: string; label: string }> = {
  WIFI: { icon: '📶', label: 'Free WiFi' },
  FREE_WIFI: { icon: '📶', label: 'Free WiFi' },
  INTERNET: { icon: '📶', label: 'Internet' },
  POOL: { icon: '🏊', label: 'Swimming Pool' },
  SWIMMING_POOL: { icon: '🏊', label: 'Pool' },
  FITNESS_CENTER: { icon: '💪', label: 'Fitness Center' },
  GYM: { icon: '💪', label: 'Gym' },
  FITNESS: { icon: '💪', label: 'Fitness' },
  RESTAURANT: { icon: '🍽️', label: 'Restaurant' },
  BAR: { icon: '🍸', label: 'Bar' },
  PARKING: { icon: '🅿️', label: 'Parking' },
  FREE_PARKING: { icon: '🅿️', label: 'Free Parking' },
  SPA: { icon: '💆', label: 'Spa' },
  AIRPORT_SHUTTLE: { icon: '🚌', label: 'Airport Shuttle' },
  AIR_CONDITIONING: { icon: '❄️', label: 'A/C' },
  PET_FRIENDLY: { icon: '🐾', label: 'Pet Friendly' },
  BEACH: { icon: '🏖️', label: 'Beach' },
  BUSINESS_CENTER: { icon: '💼', label: 'Business Center' },
  CONCIERGE: { icon: '🛎️', label: 'Concierge' },
  LAUNDRY: { icon: '👕', label: 'Laundry' },
  ROOM_SERVICE: { icon: '🛏️', label: 'Room Service' },
  BREAKFAST: { icon: '🥐', label: 'Breakfast' },
  TERRACE: { icon: '🌿', label: 'Terrace' },
  GARDEN: { icon: '🌳', label: 'Garden' },
  KIDS_CLUB: { icon: '🧸', label: "Kids' Club" },
  NON_SMOKING: { icon: '🚭', label: 'Non-Smoking' },
  ELEVATOR: { icon: '🛗', label: 'Elevator' },
  SAFE: { icon: '🔒', label: 'Safe' },
  TENNIS: { icon: '🎾', label: 'Tennis' },
  GOLF: { icon: '⛳', label: 'Golf' },
  CASINO: { icon: '🎰', label: 'Casino' },
  SAUNA: { icon: '♨️', label: 'Sauna' },
  JACUZZI: { icon: '🛁', label: 'Jacuzzi' },
  WHEELCHAIR: { icon: '♿', label: 'Accessible' },
  FAMILY_ROOMS: { icon: '👨‍👩‍👧', label: 'Family Rooms' },
  MEETING_ROOMS: { icon: '📊', label: 'Meeting Rooms' },
  TV: { icon: '📺', label: 'Flat-screen TV' },
  MINIBAR: { icon: '🥤', label: 'Minibar' },
  BALCONY: { icon: '🌅', label: 'Balcony' },
  BATHTUB: { icon: '🛁', label: 'Bathtub' },
  KITCHEN: { icon: '🍳', label: 'Kitchen' },
  COFFEE_MAKER: { icon: '☕', label: 'Coffee Maker' },
}

function amenityInfo(code: string): { icon: string; label: string } {
  if (AMENITY_MAP[code]) return AMENITY_MAP[code]
  for (const [key, val] of Object.entries(AMENITY_MAP)) {
    if (code.includes(key) || key.includes(code)) return val
  }
  const label = code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  return { icon: '✓', label }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount: string | number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Number(amount))
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function fmtReviewDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function computeNights(checkIn?: string, checkOut?: string): number | null {
  if (!checkIn || !checkOut) return null
  const [y1, m1, d1] = checkIn.split('-').map(Number)
  const [y2, m2, d2] = checkOut.split('-').map(Number)
  const n = Math.round(
    (new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000
  )
  return n > 0 ? n : null
}

function reviewLabel(s: number) {
  if (s >= 9) return 'Exceptional'
  if (s >= 8) return 'Excellent'
  if (s >= 7) return 'Very Good'
  if (s >= 6) return 'Good'
  return 'Fair'
}

function reviewBadgeClass(s: number) {
  if (s >= 9) return 'bg-emerald-600'
  if (s >= 8) return 'bg-green-600'
  if (s >= 7) return 'bg-yellow-600'
  if (s >= 6) return 'bg-orange-600'
  return 'bg-red-600'
}

/**
 * Strip dangerous HTML tags/attributes so we can safely render hotel
 * descriptions that come back with <p>, <strong>, <ul> etc. from the API.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style\s*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRow({ rating }: { rating: number | null }) {
  if (!rating) return null
  const full = Math.min(Math.round(Number(rating)), 5)
  return (
    <span className="text-yellow-400 text-sm" aria-label={`${full} stars`}>
      {'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-white/50 text-[11px] uppercase tracking-widest font-semibold border-b border-white/[0.07] pb-2">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-white/[0.07] rounded animate-pulse ${className}`} />
}

// ── ReviewCard ────────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: HotelReview }) {
  const initial = review.author ? review.author.charAt(0).toUpperCase() : '?'
  const starsFull = review.rating ? Math.min(Math.round(review.rating / 2), 5) : null

  return (
    <div className="flex-shrink-0 w-64 bg-white/[0.04] border border-white/[0.07] rounded-xl p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-600/40 to-sky-600/30 flex items-center justify-center text-sm font-semibold text-white/80 flex-shrink-0">
            {initial}
          </div>
          <div>
            <p className="text-white/80 text-xs font-medium leading-tight">{review.author || 'Guest'}</p>
            {review.date && (
              <p className="text-white/30 text-[10px] mt-0.5">{fmtReviewDate(review.date)}</p>
            )}
          </div>
        </div>
        {starsFull !== null && (
          <span className="text-yellow-400 text-xs flex-shrink-0">
            {'★'.repeat(starsFull)}{'☆'.repeat(Math.max(0, 5 - starsFull))}
          </span>
        )}
      </div>
      {review.title && (
        <p className="text-white/70 text-xs font-semibold leading-snug">{review.title}</p>
      )}
      {review.text && (
        <p className="text-white/50 text-xs leading-relaxed line-clamp-4">{review.text}</p>
      )}
    </div>
  )
}

// ── RoomCard ──────────────────────────────────────────────────────────────────

function RoomCard({
  room,
  nights,
  isSelected,
  onSelect,
  isPending,
}: {
  room: HotelRoomType
  nights: number | null
  isSelected: boolean
  onSelect: (room: HotelRoomType) => void
  isPending: boolean
}) {
  const perNight = nights && nights > 0
    ? Math.round(Number(room.price_per_night ?? Number(room.price_total) / nights))
    : null

  const hasPhoto = (room.photos?.length ?? 0) > 0
  const hasBeds = (room.beds?.length ?? 0) > 0
  const hasRoomAmenities = (room.room_amenities?.length ?? 0) > 0

  return (
    <div
      className={`rounded-xl border transition-all overflow-hidden ${
        isSelected
          ? 'border-emerald-500/60 bg-emerald-500/[0.08] ring-1 ring-emerald-500/40'
          : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex">
        {/* Room photo */}
        {hasPhoto && (
          <div className="flex-shrink-0 w-24 h-auto overflow-hidden">
            <img
              src={room.photos![0].url}
              alt={room.name}
              className="w-full h-full object-cover min-h-[80px]"
            />
          </div>
        )}

        {/* Details */}
        <div className="flex-1 p-3.5 flex items-start justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Name + best price badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white/90 font-medium text-sm">{room.name}</p>
              {room.is_cheapest && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                  Best price
                </span>
              )}
            </div>

            {/* Bed configuration */}
            {hasBeds && (
              <p className="text-white/50 text-xs flex items-center gap-1">
                <span>🛏️</span>
                <span>{room.beds!.map(b => `${b.count} ${b.type}`).join(' · ')}</span>
              </p>
            )}

            {/* Cancellation + occupancy + board */}
            <div className="flex items-center gap-2.5 flex-wrap text-xs text-white/40">
              {room.max_occupancy && <span>👤 Max {room.max_occupancy}</span>}
              {room.cancellation_type === 'free' && (
                <span className="text-emerald-400">✓ Free cancellation</span>
              )}
              {room.cancellation_type === 'non_refundable' && (
                <span className="text-orange-400/80">Non-refundable</span>
              )}
              {room.board_type && room.board_type !== 'ROOM_ONLY' && (
                <span>🥐 {room.board_type.replace(/_/g, ' ').toLowerCase()}</span>
              )}
            </div>

            {/* Room amenity chips */}
            {hasRoomAmenities && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {room.room_amenities!.slice(0, 4).map((code) => {
                  const { icon, label } = amenityInfo(code)
                  return (
                    <span
                      key={code}
                      className="text-[10px] text-white/35 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded"
                    >
                      {icon} {label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Price + select button */}
          <div className="flex-shrink-0 flex flex-col items-end gap-2">
            <div className="text-right">
              {perNight !== null && (
                <p className="text-white font-bold text-base leading-none">
                  {fmtCurrency(perNight, room.currency)}
                  <span className="text-white/35 text-[10px] font-normal">/night</span>
                </p>
              )}
              <p className="text-white/35 text-[10px] mt-0.5">
                {fmtCurrency(room.price_total, room.currency)} total
              </p>
            </div>
            <button
              onClick={() => onSelect(room)}
              disabled={isPending}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 whitespace-nowrap ${
                isSelected
                  ? 'bg-emerald-500 text-white border border-emerald-400 font-medium'
                  : 'bg-white/10 hover:bg-emerald-500/20 border border-white/20 hover:border-emerald-500/40 text-white/80 hover:text-white'
              }`}
            >
              {isSelected ? '✓ Selected' : 'Select room'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface HotelDetailSheetProps {
  offer: HotelOffer | null
  checkIn?: string
  checkOut?: string
  onClose: () => void
  onSelect: (offer: HotelOffer) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HotelDetailSheet({
  offer,
  checkIn,
  checkOut,
  onClose,
  onSelect,
}: HotelDetailSheetProps) {
  const [photoIdx, setPhotoIdx] = useState(0)
  const [showPhotoGrid, setShowPhotoGrid] = useState(false)
  // Track which room the user has selected (two-step: select → highlight, CTA → prebook)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)

  const prebook = usePrebookHotel()
  const setHotelPrebookId = useBookingStore((s) => s.setHotelPrebookId)

  // Lazy-load rich details for LiteAPI hotels.
  // Pass hotel name + coords so the backend can enrich with Google/Foursquare photos & reviews.
  const _geoCoords = offer?.accommodation.location.geographic_coordinates
  const detail = useHotelDetail(
    offer?.hotel_id,
    offer?.provider ?? '',
    offer?.accommodation.name,
    _geoCoords?.latitude,
    _geoCoords?.longitude,
  )
  const isLiteApi = offer?.id.startsWith('liteapi_hotel_') ?? false

  // Merge photos from offer + detail (deduplicate by URL)
  const basePhotos = offer?.accommodation.photos ?? []
  const detailPhotos = detail.data?.photos ?? []
  const seenUrls = new Set(basePhotos.map((p) => p.url))
  const allPhotos = [...basePhotos, ...detailPhotos.filter((p) => !seenUrls.has(p.url))]

  const nights = computeNights(checkIn, checkOut)
  const coords = offer?.accommodation.location.geographic_coordinates

  // Selected room derived values
  const selectedRoom = offer?.room_types?.find((r) => r.id === selectedRoomId) ?? null
  const baseTotal = offer ? parseFloat(offer.cheapest_rate_total_amount) : 0
  const activeTotal = selectedRoom ? parseFloat(selectedRoom.price_total) : baseTotal
  const activeCurrency = selectedRoom?.currency ?? offer?.cheapest_rate_currency ?? 'USD'
  const activePerNight = nights ? Math.round(activeTotal / nights) : null

  // Rich data from detail endpoint
  const description = detail.data?.description ?? ''
  const amenities = detail.data?.amenities ?? []
  const reviewScore = detail.data?.review_score
  const reviewCount = detail.data?.review_count
  const checkInTime = detail.data?.check_in_time
  const checkOutTime = detail.data?.check_out_time
  const reviews = detail.data?.reviews ?? []

  const numPhotos = Math.max(allPhotos.length, 1)
  const nextPhoto = useCallback(() => setPhotoIdx((i) => (i + 1) % numPhotos), [numPhotos])
  const prevPhoto = useCallback(() => setPhotoIdx((i) => (i - 1 + numPhotos) % numPhotos), [numPhotos])

  function handleSelectRoom(room: HotelRoomType) {
    // Toggle: clicking the already-selected room deselects it
    setSelectedRoomId((prev) => (prev === room.id ? null : room.id))
  }

  async function handleConfirmSelection() {
    if (!offer) return

    // If user picked a specific room, book that room; otherwise book the hotel's cheapest rate
    const targetId = selectedRoom ? selectedRoom.id : offer.id
    const targetOffer: HotelOffer = selectedRoom
      ? {
          ...offer,
          id: selectedRoom.id,
          cheapest_rate_total_amount: selectedRoom.price_total,
          cheapest_rate_currency: selectedRoom.currency,
        }
      : offer

    if (isLiteApi) {
      try {
        const prebookId = await prebook.mutateAsync(targetId)
        setHotelPrebookId(prebookId)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          toast.error('This offer has expired. Please search again.', { duration: 5000 })
          onClose()
        } else {
          toast.error('Could not confirm this offer. Please try again.')
        }
        return
      }
    }
    onSelect(targetOffer)
  }

  const content = (
    <AnimatePresence>
      {offer && (
        <>
          {/* Backdrop */}
          <motion.div
            key="hotel-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60]"
            data-testid="hotel-detail-backdrop"
          />

          {/* Full-screen bottom sheet */}
          <motion.div
            key="hotel-detail-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-[65] flex flex-col overflow-hidden"
            style={{
              top: '4vh',
              background: 'rgba(6, 8, 20, 0.99)',
              backdropFilter: 'blur(32px)',
              borderRadius: '22px 22px 0 0',
            }}
            data-testid="hotel-detail-sheet"
          >
            {/* ── Top bar ─────────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-white/[0.07]">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 text-white/55 hover:text-white text-sm transition-colors"
                data-testid="hotel-detail-close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to results
              </button>

              <div className="flex items-center gap-2.5">
                {/* Provider badge */}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    offer.provider === 'liteapi'
                      ? 'bg-sky-500/15 text-sky-400 border-sky-400/25'
                      : 'bg-white/10 text-white/40 border-white/20'
                  }`}
                >
                  {offer.provider === 'liteapi' ? 'LiteAPI' : 'Duffel'}
                </span>

                {/* Review score */}
                {reviewScore && (
                  <div className="flex items-center gap-1.5">
                    <span className={`text-white text-xs font-bold px-1.5 py-0.5 rounded-md ${reviewBadgeClass(reviewScore)}`}>
                      {reviewScore.toFixed(1)}
                    </span>
                    <span className="text-white/45 text-xs hidden sm:inline">
                      {reviewLabel(reviewScore)}
                      {reviewCount ? ` · ${reviewCount.toLocaleString()} reviews` : ''}
                    </span>
                  </div>
                )}
                {detail.isLoading && offer.provider === 'liteapi' && (
                  <Skeleton className="w-20 h-5" />
                )}
              </div>
            </div>

            {/* ── Scrollable body ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Photo carousel ──────────────────────────────── */}
              <div className="relative bg-black select-none" style={{ height: 'clamp(220px, 46vh, 420px)' }}>
                {allPhotos.length > 0 ? (
                  <>
                    <img
                      key={allPhotos[photoIdx]?.url}
                      src={allPhotos[photoIdx]?.url}
                      alt={`${offer.accommodation.name} — photo ${photoIdx + 1}`}
                      className="w-full h-full object-cover"
                      style={{ transition: 'opacity 0.2s' }}
                    />

                    {/* Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/20 pointer-events-none" />

                    {/* Counter pill */}
                    <div className="absolute top-3 right-3 bg-black/55 text-white/80 text-xs px-2 py-0.5 rounded-full backdrop-blur-sm">
                      {photoIdx + 1} / {allPhotos.length}
                    </div>

                    {/* View all photos button */}
                    {allPhotos.length > 1 && (
                      <button
                        onClick={() => setShowPhotoGrid(true)}
                        className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/55 hover:bg-black/80 text-white/80 hover:text-white text-xs px-2.5 py-1.5 rounded-full backdrop-blur-sm transition-colors"
                        aria-label={`View all ${allPhotos.length} photos`}
                        data-testid="view-all-photos-btn"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                        {allPhotos.length} photos
                      </button>
                    )}

                    {/* Prev / Next arrows */}
                    {allPhotos.length > 1 && (
                      <>
                        <button
                          onClick={prevPhoto}
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center text-white transition-colors backdrop-blur-sm"
                          aria-label="Previous photo"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <button
                          onClick={nextPhoto}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center text-white transition-colors backdrop-blur-sm"
                          aria-label="Next photo"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </>
                    )}

                    {/* Hotel name overlay */}
                    <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
                      <h2 className="text-white font-bold text-xl leading-snug drop-shadow-lg">
                        {offer.accommodation.name}
                      </h2>
                      <div className="mt-0.5">
                        <StarRow rating={offer.accommodation.rating} />
                      </div>
                    </div>

                    {/* Thumbnail strip */}
                    {allPhotos.length > 1 && (
                      <div
                        className="absolute bottom-16 left-0 right-0 flex gap-1.5 px-5 overflow-x-auto"
                        style={{ scrollbarWidth: 'none' }}
                      >
                        {allPhotos.slice(0, 14).map((photo, i) => (
                          <button
                            key={i}
                            onClick={() => setPhotoIdx(i)}
                            className={`flex-shrink-0 rounded overflow-hidden transition-all ${
                              i === photoIdx
                                ? 'ring-2 ring-white opacity-100 w-11 h-8'
                                : 'opacity-50 hover:opacity-80 w-9 h-7'
                            }`}
                          >
                            <img src={photo.url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* ── Photo grid overlay ──────────────────────── */}
                    {showPhotoGrid && (
                      <div
                        className="absolute inset-0 z-10 bg-black overflow-y-auto"
                        style={{ scrollbarWidth: 'none' }}
                        data-testid="photo-grid-overlay"
                      >
                        {/* Grid header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-black/90 backdrop-blur-sm border-b border-white/[0.08]">
                          <span className="text-white/70 text-sm font-medium">
                            {offer.accommodation.name} · {allPhotos.length} photos
                          </span>
                          <button
                            onClick={() => setShowPhotoGrid(false)}
                            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                            aria-label="Close photo gallery"
                            data-testid="close-photo-grid-btn"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {/* Photo grid */}
                        <div className="grid grid-cols-2 gap-0.5 p-0.5">
                          {allPhotos.map((photo, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setPhotoIdx(i)
                                setShowPhotoGrid(false)
                              }}
                              className="relative aspect-[4/3] overflow-hidden hover:opacity-90 transition-opacity"
                            >
                              <img
                                src={photo.url}
                                alt={`Photo ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                              {i === photoIdx && (
                                <div className="absolute inset-0 ring-2 ring-inset ring-white/80" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  // No photos placeholder
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-white/[0.03] to-transparent">
                    <span className="text-5xl opacity-15">🏨</span>
                    <div className="text-center px-8">
                      <h2 className="text-white font-bold text-2xl">{offer.accommodation.name}</h2>
                      <div className="mt-1"><StarRow rating={offer.accommodation.rating} /></div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Content sections ────────────────────────────── */}
              <div className="px-5 py-6 space-y-8 pb-36">

                {/* Quick-info block */}
                <div className="space-y-2.5">
                  {/* Name + stars when no photos */}
                  {allPhotos.length === 0 && (
                    <div className="space-y-1">
                      <h2 className="text-white font-bold text-xl">{offer.accommodation.name}</h2>
                      <StarRow rating={offer.accommodation.rating} />
                    </div>
                  )}

                  {/* Address */}
                  {offer.accommodation.address && (
                    <div className="flex items-start gap-2 text-white/60 text-sm">
                      <span className="flex-shrink-0 mt-0.5">📍</span>
                      <span>{offer.accommodation.address}</span>
                    </div>
                  )}

                  {/* Stay dates */}
                  {(checkIn || checkOut) && (
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm">
                      {checkIn && (
                        <span className="text-white/50">
                          Check-in: <span className="text-white/90">{fmtDate(checkIn)}</span>
                          {checkInTime && <span className="text-white/35 ml-1">· {checkInTime}</span>}
                        </span>
                      )}
                      {checkOut && (
                        <span className="text-white/50">
                          Check-out: <span className="text-white/90">{fmtDate(checkOut)}</span>
                          {checkOutTime && <span className="text-white/35 ml-1">· {checkOutTime}</span>}
                        </span>
                      )}
                      {nights && (
                        <span className="text-emerald-400/80 text-xs font-medium">
                          {nights} night{nights !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* About — HTML-rendered (handles <p>, <strong>, <ul> etc from API) */}
                {(description || detail.isLoading) && (
                  <Section title="About">
                    {detail.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                        <Skeleton className="h-3 w-4/5" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    ) : (
                      <div
                        className="text-white/60 text-sm leading-relaxed
                          [&_p]:mb-3 [&_p:last-child]:mb-0
                          [&_strong]:text-white/85 [&_strong]:font-semibold
                          [&_b]:text-white/85 [&_b]:font-semibold
                          [&_h1]:text-white/80 [&_h1]:font-bold [&_h1]:text-base [&_h1]:mb-2 [&_h1]:mt-3
                          [&_h2]:text-white/80 [&_h2]:font-semibold [&_h2]:text-sm [&_h2]:mb-2 [&_h2]:mt-3
                          [&_h3]:text-white/75 [&_h3]:font-semibold [&_h3]:text-xs [&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:uppercase [&_h3]:tracking-wide
                          [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:space-y-1 [&_ul]:mb-3
                          [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:space-y-1 [&_ol]:mb-3
                          [&_li]:text-white/55
                          [&_a]:text-emerald-400 [&_a:hover]:text-emerald-300"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
                      />
                    )}
                  </Section>
                )}

                {/* Amenities */}
                {(amenities.length > 0 || detail.isLoading) && (
                  <Section title="Amenities">
                    {detail.isLoading ? (
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <Skeleton key={i} className="h-7 rounded-full" style={{ width: `${60 + (i % 4) * 20}px` }} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {amenities.slice(0, 24).map((code) => {
                          const { icon, label } = amenityInfo(code)
                          return (
                            <span
                              key={code}
                              className="flex items-center gap-1.5 text-xs text-white/70 bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] px-2.5 py-1.5 rounded-full transition-colors"
                            >
                              <span>{icon}</span>
                              <span>{label}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </Section>
                )}

                {/* Available rooms */}
                {(offer.room_types?.length ?? 0) > 0 && (
                  <Section title="Available Rooms">
                    <div className="space-y-2.5">
                      {offer.room_types!.map((room) => (
                        <RoomCard
                          key={room.id}
                          room={room}
                          nights={nights}
                          isSelected={room.id === selectedRoomId}
                          onSelect={handleSelectRoom}
                          isPending={prebook.isPending}
                        />
                      ))}
                    </div>
                    {selectedRoomId && (
                      <p className="text-white/35 text-xs mt-2 text-center">
                        ↓ Click &ldquo;Reserve&rdquo; below to confirm your selection
                      </p>
                    )}
                  </Section>
                )}

                {/* Location map — Google Maps embed forces English labels */}
                {coords && (
                  <Section title="Location">
                    <div className="space-y-2.5">
                      {offer.accommodation.address && (
                        <p className="text-white/50 text-sm">{offer.accommodation.address}</p>
                      )}

                      <div
                        className="rounded-xl overflow-hidden border border-white/10"
                        style={{ height: 260 }}
                      >
                        <iframe
                          title={`Map — ${offer.accommodation.name}`}
                          loading="lazy"
                          className="w-full h-full"
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                            coords.longitude - 0.006
                          },${coords.latitude - 0.006},${coords.longitude + 0.006},${
                            coords.latitude + 0.006
                          }&layer=mapnik&marker=${coords.latitude},${coords.longitude}&lang=en`}
                          style={{
                            border: 0,
                            filter: 'invert(0.92) hue-rotate(195deg) brightness(0.82) saturate(0.9)',
                          }}
                        />
                      </div>

                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${coords.latitude},${coords.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-emerald-400 text-xs hover:text-emerald-300 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open in Google Maps
                      </a>
                    </div>
                  </Section>
                )}

                {/* Guest reviews */}
                {reviews.length > 0 && (
                  <Section
                    title={`Guest Reviews${reviewCount ? ` · ${reviewCount.toLocaleString()} total` : ''}`}
                  >
                    <div
                      className="flex gap-3 overflow-x-auto pb-2"
                      style={{ scrollbarWidth: 'none' }}
                    >
                      {reviews.map((review, i) => (
                        <ReviewCard key={i} review={review} />
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            </div>

            {/* ── Sticky footer CTA ────────────────────────────── */}
            <div
              className="flex-shrink-0 border-t border-white/[0.08] px-5 py-4 flex items-center gap-4"
              style={{ background: 'rgba(6, 8, 20, 0.97)', backdropFilter: 'blur(20px)' }}
            >
              <div className="flex-1 min-w-0">
                {activePerNight !== null ? (
                  <div>
                    <p className="text-white font-bold text-lg leading-none">
                      {fmtCurrency(activePerNight, activeCurrency)}
                      <span className="text-white/35 text-xs font-normal ml-1">/night</span>
                    </p>
                    <p className="text-white/40 text-xs mt-0.5">
                      {fmtCurrency(activeTotal, activeCurrency)} total
                      {nights ? ` · ${nights} night${nights !== 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-white font-bold text-lg leading-none">
                      {fmtCurrency(activeTotal, activeCurrency)}
                    </p>
                    <p className="text-white/40 text-xs mt-0.5">
                      {selectedRoom ? selectedRoom.name : 'Best available rate'}
                    </p>
                  </div>
                )}
              </div>

              <GlassButton
                onClick={handleConfirmSelection}
                disabled={prebook.isPending}
                data-testid="hotel-select-btn"
              >
                {prebook.isPending ? (
                  <>
                    <span className="inline-block animate-spin mr-1">🔒</span>
                    Confirming…
                  </>
                ) : selectedRoom ? (
                  'Reserve →'
                ) : (
                  'Select this hotel →'
                )}
              </GlassButton>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}
