/**
 * Tests for the redesigned HotelDetailSheet component.
 *
 * Covers:
 *  Rendering
 *  — Renders null when offer is null
 *  — Shows hotel name, provider badge, address, star rating, dates
 *  — Footer: per-night price + total when dates provided
 *  — Footer: "Best available rate" when no dates
 *  — "Confirming…" spinner + disabled state while prebook is pending
 *
 *  Photo carousel
 *  — Shows first photo, counter, prev/next arrows
 *  — Prev/next cycle correctly
 *  — Thumbnail clicks change active photo
 *  — Placeholder shown when no photos
 *  — Photos from detail endpoint are merged (deduplicated)
 *
 *  Detail lazy-loading (useHotelDetail)
 *  — Description + amenities skeletons while loading
 *  — Review score badge + label shown once loaded
 *  — Hotel description text shown once loaded
 *  — Amenity chips shown once loaded
 *  — Check-in / check-out times appended once loaded
 *
 *  Room type cards
 *  — Room name, "Best price" badge, cancellation, occupancy shown
 *  — "Select room" calls prebook (LiteAPI) then onSelect with room's offer variant
 *
 *  Map section
 *  — OSM iframe src contains lat/lng
 *  — "Open in Google Maps" link has correct href
 *  — Map section absent when no coordinates
 *
 *  Navigation
 *  — "Back to results" calls onClose
 *  — Backdrop click calls onClose
 *
 *  LiteAPI prebook flow
 *  — mutateAsync called with offer id, prebookId stored, onSelect called
 *  — 409 → toast + onClose, no onSelect
 *  — Other error → toast, no onClose, no onSelect
 *
 *  Duffel (no prebook)
 *  — onSelect called immediately; prebook not called; prebookId not written
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HotelDetailSheet from '../HotelDetailSheet'
import type { HotelOffer } from '../../../types/booking'
import * as HotelSearchHooks from '../../../hooks/useHotelSearch'
import { useBookingStore } from '../../../stores/bookingStore'
import { ApiError } from '../../../lib/api'
import toast from 'react-hot-toast'

// ─── Global mocks ─────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../../hooks/useHotelSearch', () => ({
  usePrebookHotel: vi.fn(),
  useHotelDetail: vi.fn(),
  useHotelSearch: vi.fn(),
  useBookHotel: vi.fn(),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const liteapiOffer: HotelOffer = {
  id: 'liteapi_hotel_RATE_XYZ',
  hotel_id: 'hotel_123',
  provider: 'liteapi',
  accommodation: {
    name: 'Park Hyatt Tokyo',
    rating: 5,
    photos: [
      { url: 'https://example.com/photo1.jpg' },
      { url: 'https://example.com/photo2.jpg' },
      { url: 'https://example.com/photo3.jpg' },
    ],
    location: { geographic_coordinates: { latitude: 35.69, longitude: 139.7 } },
    address: '3-7-1-2 Nishi-Shinjuku, Tokyo',
  },
  cheapest_rate_total_amount: '800.00',
  cheapest_rate_currency: 'USD',
  room_types: [
    {
      id: 'liteapi_hotel_room_deluxe',
      name: 'Deluxe King Room',
      max_occupancy: 2,
      price_total: '800.00',
      price_per_night: '200.00',
      currency: 'USD',
      is_cheapest: true,
      cancellation_type: 'free',
      board_type: 'ROOM_ONLY',
    },
    {
      id: 'liteapi_hotel_room_suite',
      name: 'Park Suite',
      max_occupancy: 3,
      price_total: '1200.00',
      price_per_night: '300.00',
      currency: 'USD',
      is_cheapest: false,
      cancellation_type: 'non_refundable',
      board_type: 'BED_AND_BREAKFAST',
    },
  ],
}

/** Duffel offer — id does NOT start with "liteapi_hotel_", no prebook step. */
const duffelOffer: HotelOffer = {
  id: 'duffel-hotel-1',
  provider: 'duffel',
  accommodation: {
    name: 'Grand Hotel Tokyo',
    rating: 4,
    photos: [
      { url: 'https://example.com/photo1.jpg' },
      { url: 'https://example.com/photo2.jpg' },
    ],
    location: { geographic_coordinates: { latitude: 35.6762, longitude: 139.6503 } },
    address: '1-2-3 Shinjuku, Tokyo 160-0022',
  },
  cheapest_rate_total_amount: '320.00',
  cheapest_rate_currency: 'USD',
}

const noPhotosOffer: HotelOffer = {
  ...duffelOffer,
  accommodation: { ...duffelOffer.accommodation, photos: [] },
}

const noCoordsOffer: HotelOffer = {
  ...duffelOffer,
  accommodation: {
    ...duffelOffer.accommodation,
    location: { geographic_coordinates: null },
  },
}

const DETAIL_DATA = {
  hotel_id: 'hotel_123',
  description: 'A luxury hotel in the heart of Shinjuku with stunning city views.',
  amenities: ['WIFI', 'POOL', 'FITNESS_CENTER', 'RESTAURANT', 'SPA'],
  photos: [
    { url: 'https://example.com/extra1.jpg' },
    { url: 'https://example.com/extra2.jpg' },
  ],
  review_score: 9.2,
  review_count: 1847,
  check_in_time: '15:00',
  check_out_time: '11:00',
}

const mockMutateAsync = vi.fn()

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: prebook resolves immediately
  vi.mocked(HotelSearchHooks.usePrebookHotel).mockReturnValue({
    mutateAsync: mockMutateAsync.mockResolvedValue('PB-DEFAULT'),
    isPending: false,
  } as any)

  // Default: no detail loaded yet
  vi.mocked(HotelSearchHooks.useHotelDetail).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as any)

  // Reset the Zustand store
  useBookingStore.setState({ hotelPrebookId: null })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function mockDetailLoaded(overrides: Partial<typeof DETAIL_DATA> = {}) {
  vi.mocked(HotelSearchHooks.useHotelDetail).mockReturnValue({
    data: { ...DETAIL_DATA, ...overrides },
    isLoading: false,
    isError: false,
  } as any)
}

function mockDetailLoading() {
  vi.mocked(HotelSearchHooks.useHotelDetail).mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
  } as any)
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — rendering', () => {
  it('renders nothing when offer is null', () => {
    const { container } = render(
      <HotelDetailSheet offer={null} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the sheet when an offer is provided', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('hotel-detail-sheet')).toBeInTheDocument()
  })

  it('displays the hotel name', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Grand Hotel Tokyo')).toBeInTheDocument()
  })

  it('shows the star rating', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByLabelText('4 stars')).toBeInTheDocument()
  })

  it('shows the LiteAPI provider badge', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('LiteAPI')).toBeInTheDocument()
  })

  it('shows the Duffel provider badge', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Duffel')).toBeInTheDocument()
  })

  it('displays the hotel address', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    // Address appears in both the identity row and the Location section map caption
    expect(screen.getAllByText('1-2-3 Shinjuku, Tokyo 160-0022').length).toBeGreaterThan(0)
  })

  it('shows check-in and check-out dates when provided', () => {
    render(
      <HotelDetailSheet
        offer={duffelOffer}
        checkIn="2025-06-10"
        checkOut="2025-06-15"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText(/Check-in/)).toBeInTheDocument()
    expect(screen.getByText(/Check-out/)).toBeInTheDocument()
  })

  it('shows night count in the dates section', () => {
    render(
      <HotelDetailSheet
        offer={duffelOffer}
        checkIn="2025-06-10"
        checkOut="2025-06-15"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    // "5 nights" appears in the dates badge and also in the footer price subtitle
    expect(screen.getAllByText(/5 nights/).length).toBeGreaterThan(0)
  })

  it('does not render dates section when check-in/out are absent', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText(/Check-in/)).not.toBeInTheDocument()
  })

  it('shows per-night price in footer when dates are provided', () => {
    // $800 / 4 nights = $200/night
    render(
      <HotelDetailSheet
        offer={liteapiOffer}
        checkIn="2024-05-01"
        checkOut="2024-05-05"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getAllByText(/\$200/)[0]).toBeInTheDocument()
  })

  it('shows "Best available rate" when no dates are provided', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Best available rate')).toBeInTheDocument()
  })

  it('shows total price in the footer', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/\$320/)).toBeInTheDocument()
  })

  it('shows the "Select this hotel" CTA button', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('hotel-select-btn')).toBeInTheDocument()
  })

  it('shows the "Back to results" button', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('hotel-detail-close')).toBeInTheDocument()
  })

  it('shows "Confirming…" and disables button when prebook is pending', () => {
    vi.mocked(HotelSearchHooks.usePrebookHotel).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as any)
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/Confirming/)).toBeInTheDocument()
    expect(screen.getByTestId('hotel-select-btn')).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO GALLERY
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — photo gallery', () => {
  it('shows the first photo by default', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    // The main carousel image is the first img element in the carousel section
    const imgs = screen.getAllByRole('img').filter(
      (img) => (img as HTMLImageElement).alt.includes('Park Hyatt Tokyo')
    )
    expect(imgs[0]).toHaveAttribute('src', 'https://example.com/photo1.jpg')
  })

  it('shows a photo counter (1 / 3)', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('renders prev and next arrow buttons', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByLabelText('Previous photo')).toBeInTheDocument()
    expect(screen.getByLabelText('Next photo')).toBeInTheDocument()
  })

  it('advances to the next photo when next arrow is clicked', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Next photo'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    const mainImg = screen.getAllByRole('img').filter(
      (img) => (img as HTMLImageElement).alt.includes('Park Hyatt Tokyo')
    )[0]
    expect(mainImg).toHaveAttribute('src', 'https://example.com/photo2.jpg')
  })

  it('wraps to the last photo when prev is clicked on the first photo', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Previous photo'))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('no arrow buttons when the offer has only one photo', () => {
    const singlePhoto: HotelOffer = {
      ...duffelOffer,
      accommodation: { ...duffelOffer.accommodation, photos: [{ url: 'https://example.com/only.jpg' }] },
    }
    render(<HotelDetailSheet offer={singlePhoto} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByLabelText('Next photo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous photo')).not.toBeInTheDocument()
  })

  it('shows a placeholder (no arrow buttons) when there are no photos', () => {
    render(<HotelDetailSheet offer={noPhotosOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByLabelText('Next photo')).not.toBeInTheDocument()
  })

  it('merges extra photos from the detail endpoint', () => {
    // liteapiOffer has 3 photos; DETAIL_DATA adds 2 non-duplicate photos → total 5
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
  })

  it('does not duplicate photos already in the offer', () => {
    // detail photos overlap with base photos — only the new ones are appended
    mockDetailLoaded({
      photos: [
        { url: 'https://example.com/photo1.jpg' }, // already in offer
        { url: 'https://example.com/brand_new.jpg' },
      ],
    })
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    // 3 base + 1 new (photo1 deduplicated) = 4
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL LOADING STATE
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — detail loading state', () => {
  it('shows the "About" section heading with skeleton while loading', () => {
    mockDetailLoading()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/about/i)).toBeInTheDocument()
    // Actual description is not yet visible
    expect(
      screen.queryByText('A luxury hotel in the heart of Shinjuku with stunning city views.')
    ).not.toBeInTheDocument()
  })

  it('shows the "Amenities" section heading with skeleton while loading', () => {
    mockDetailLoading()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/amenities/i)).toBeInTheDocument()
    expect(screen.queryByText('Free WiFi')).not.toBeInTheDocument()
  })

  it('does not show review score while detail is loading', () => {
    mockDetailLoading()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText('9.2')).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL LOADED
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — detail loaded', () => {
  it('shows review score badge', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('9.2')).toBeInTheDocument()
  })

  it('shows review label "Exceptional" for score ≥ 9', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/Exceptional/)).toBeInTheDocument()
  })

  it('shows review count', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/1,847 reviews/)).toBeInTheDocument()
  })

  it('shows hotel description text', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(
      screen.getByText('A luxury hotel in the heart of Shinjuku with stunning city views.')
    ).toBeInTheDocument()
  })

  it('renders amenity chips for each amenity code', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Free WiFi')).toBeInTheDocument()
    expect(screen.getByText('Swimming Pool')).toBeInTheDocument()
    expect(screen.getByText('Fitness Center')).toBeInTheDocument()
    expect(screen.getByText('Restaurant')).toBeInTheDocument()
    expect(screen.getByText('Spa')).toBeInTheDocument()
  })

  it('appends check-in time after the date when provided', () => {
    mockDetailLoaded()
    render(
      <HotelDetailSheet
        offer={liteapiOffer}
        checkIn="2024-05-01"
        checkOut="2024-05-05"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText(/15:00/)).toBeInTheDocument()
    expect(screen.getByText(/11:00/)).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ROOM TYPES
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — room types', () => {
  it('renders a card for each room type', () => {
    render(
      <HotelDetailSheet
        offer={liteapiOffer}
        checkIn="2024-05-01"
        checkOut="2024-05-05"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Deluxe King Room')).toBeInTheDocument()
    expect(screen.getByText('Park Suite')).toBeInTheDocument()
  })

  it('shows "Best price" badge on the cheapest room', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Best price')).toBeInTheDocument()
  })

  it('shows "Free cancellation" on eligible rooms', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('✓ Free cancellation')).toBeInTheDocument()
  })

  it('shows "Non-refundable" on non-free-cancel rooms', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Non-refundable')).toBeInTheDocument()
  })

  it('shows max occupancy for each room', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/Max 2/)).toBeInTheDocument()
    expect(screen.getByText(/Max 3/)).toBeInTheDocument()
  })

  it('does not render the "Available Rooms" section when room_types is absent', () => {
    render(<HotelDetailSheet offer={noCoordsOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText(/available rooms/i)).not.toBeInTheDocument()
  })

  it('calls prebook then onSelect with the room offer variant on "Select room"', async () => {
    mockMutateAsync.mockResolvedValue('PB_ROOM')
    const onSelect = vi.fn()
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />
    )
    const [firstSelectRoom] = screen.getAllByText('Select room')
    fireEvent.click(firstSelectRoom)

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith('liteapi_hotel_room_deluxe')
    )
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'liteapi_hotel_room_deluxe',
          cheapest_rate_total_amount: '800.00',
        })
      )
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MAP
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — map', () => {
  it('renders an OpenStreetMap embed iframe with correct coordinates', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    const iframe = document.querySelector('iframe')
    expect(iframe).toBeInTheDocument()
    expect(iframe?.src).toContain('openstreetmap.org')
    expect(iframe?.src).toContain('35.69')
    expect(iframe?.src).toContain('139.7')
  })

  it('shows a "Open in Google Maps" link pointing to correct coordinates', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    const link = screen.getByText(/Open in Google Maps/).closest('a')
    expect(link).toHaveAttribute('href', expect.stringContaining('google.com/maps'))
    expect(link).toHaveAttribute('href', expect.stringContaining('35.69'))
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not render the map section when coordinates are absent', () => {
    render(<HotelDetailSheet offer={noCoordsOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
    expect(screen.queryByText(/Open in Google Maps/)).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — navigation', () => {
  it('calls onClose when "Back to results" is clicked', () => {
    const onClose = vi.fn()
    render(<HotelDetailSheet offer={duffelOffer} onClose={onClose} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('hotel-detail-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<HotelDetailSheet offer={duffelOffer} onClose={onClose} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('hotel-detail-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LITEAPI PREBOOK FLOW
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — LiteAPI prebook flow', () => {
  it('calls mutateAsync with the offer id on "Select this hotel"', async () => {
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith('liteapi_hotel_RATE_XYZ')
    )
  })

  it('stores the returned prebookId in the booking store', async () => {
    mockMutateAsync.mockResolvedValue('PB-RETURNED')
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() =>
      expect(useBookingStore.getState().hotelPrebookId).toBe('PB-RETURNED')
    )
  })

  it('calls onSelect with the offer after successful prebook', async () => {
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(liteapiOffer))
  })

  it('shows a stale-offer toast and calls onClose on 409 prebook error', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('Offer expired', 409))
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={onClose} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('expired'),
        expect.any(Object)
      )
      expect(onClose).toHaveBeenCalledOnce()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  it('shows a generic retry toast (no onClose) for non-409 prebook errors', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('Network error', 502))
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={onClose} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('try again')
      )
      expect(onClose).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  it('does not call onSelect when prebook fails', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('Server error', 500))
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onSelect).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DUFFEL — NO PREBOOK
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — Duffel offer (no prebook)', () => {
  it('calls onSelect immediately without calling prebook', () => {
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(duffelOffer)
  })

  it('does not write hotelPrebookId to the store for Duffel offers', () => {
    render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('hotel-select-btn'))
    expect(useBookingStore.getState().hotelPrebookId).toBeNull()
  })
})
