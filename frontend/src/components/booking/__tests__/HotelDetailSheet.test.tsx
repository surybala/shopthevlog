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
 *  — Prev/next cycle correctly; thumbnail clicks change active photo
 *  — "X photos" button visible when multiple photos exist
 *  — Photo grid overlay opens/closes; clicking a grid photo jumps to it
 *  — Placeholder shown when no photos
 *  — Photos from detail endpoint are merged (deduplicated)
 *
 *  Detail lazy-loading (useHotelDetail)
 *  — Description + amenities skeletons while loading
 *  — Review score badge + label shown once loaded
 *  — About section renders HTML tags (sanitized dangerouslySetInnerHTML)
 *  — Amenity chips shown once loaded
 *  — Check-in / check-out times appended once loaded
 *
 *  Room type cards
 *  — Room name, "Best price" badge, cancellation, occupancy shown
 *  — Bed info shown when room has bed configuration
 *  — Room amenity chips shown when available
 *  — Clicking "Select room" highlights card (✓ Selected) without prebooking
 *  — Clicking a selected room deselects it
 *  — Footer price updates to the selected room's price
 *  — Clicking footer CTA after selecting a room calls prebook + onSelect with room variant
 *  — Footer CTA label is "Reserve →" when a room is selected
 *
 *  Map section
 *  — iframe src contains openstreetmap.org with lat/lng + lang=en
 *  — "Open in Google Maps" link has correct href
 *  — Map section absent when no coordinates
 *
 *  Guest Reviews
 *  — Reviews section shown when detail contains reviews
 *  — Shows reviewer name, optional rating, and text
 *  — Does not show reviews section when reviews list is empty
 *
 *  Navigation
 *  — "Back to results" calls onClose
 *  — Backdrop click calls onClose
 *
 *  LiteAPI prebook flow (via footer CTA — no room selected)
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

/** LiteAPI offer with enhanced room data (beds + room amenities) */
const liteapiOfferWithRoomDetails: HotelOffer = {
  ...liteapiOffer,
  room_types: [
    {
      ...liteapiOffer.room_types![0],
      photos: [{ url: 'https://example.com/room1.jpg' }],
      beds: [{ type: 'King', count: 1 }],
      room_amenities: ['TV', 'MINIBAR', 'BALCONY'],
    },
    liteapiOffer.room_types![1],
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
  reviews: [
    {
      author: 'Sarah M.',
      rating: 9,
      title: 'Outstanding stay',
      text: 'The hotel was absolutely spectacular. Service was impeccable.',
      date: '2024-03-15',
    },
    {
      author: 'James K.',
      rating: 8,
      title: 'Great views',
      text: 'Amazing panoramic views of Tokyo. The rooms are spacious and well-appointed.',
      date: '2024-02-20',
    },
  ],
}

const DETAIL_DATA_HTML_DESC = {
  ...DETAIL_DATA,
  description: '<p>A <strong>luxury</strong> hotel in <em>Shinjuku</em>.</p><ul><li>City views</li><li>Fine dining</li></ul>',
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

  it('shows "X photos" button when multiple photos exist', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('view-all-photos-btn')).toBeInTheDocument()
    expect(screen.getByTestId('view-all-photos-btn').textContent).toMatch(/3 photos/)
  })

  it('does not show "X photos" button when only one photo', () => {
    const singlePhoto: HotelOffer = {
      ...duffelOffer,
      accommodation: { ...duffelOffer.accommodation, photos: [{ url: 'https://example.com/only.jpg' }] },
    }
    render(<HotelDetailSheet offer={singlePhoto} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByTestId('view-all-photos-btn')).not.toBeInTheDocument()
  })

  it('opens photo grid overlay when "X photos" button is clicked', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByTestId('photo-grid-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('view-all-photos-btn'))
    expect(screen.getByTestId('photo-grid-overlay')).toBeInTheDocument()
  })

  it('closes photo grid overlay when close button is clicked', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('view-all-photos-btn'))
    expect(screen.getByTestId('photo-grid-overlay')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('close-photo-grid-btn'))
    expect(screen.queryByTestId('photo-grid-overlay')).not.toBeInTheDocument()
  })

  it('clicking a photo in the grid closes the grid and navigates to that photo', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('view-all-photos-btn'))
    // The grid overlay contains: [0] close button, [1] photo 0, [2] photo 1, [3] photo 2
    const gridBtns = screen.getByTestId('photo-grid-overlay').querySelectorAll('button')
    fireEvent.click(gridBtns[3]) // 3rd photo (index 2)
    expect(screen.queryByTestId('photo-grid-overlay')).not.toBeInTheDocument()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('merges extra photos from the detail endpoint', () => {
    // liteapiOffer has 3 photos; DETAIL_DATA adds 2 non-duplicate photos → total 5
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
  })

  it('does not duplicate photos already in the offer', () => {
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

  it('shows plain text hotel description', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(
      screen.getByText('A luxury hotel in the heart of Shinjuku with stunning city views.')
    ).toBeInTheDocument()
  })

  it('renders HTML description tags — <strong> text is visible in the DOM', () => {
    vi.mocked(HotelSearchHooks.useHotelDetail).mockReturnValue({
      data: DETAIL_DATA_HTML_DESC,
      isLoading: false,
      isError: false,
    } as any)
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    // The word "luxury" was wrapped in <strong> — it should still be visible as text
    expect(screen.getByText(/luxury/i)).toBeInTheDocument()
    // List item text should also be visible
    expect(screen.getByText('City views')).toBeInTheDocument()
    expect(screen.getByText('Fine dining')).toBeInTheDocument()
  })

  it('strips dangerous script tags from the description', () => {
    vi.mocked(HotelSearchHooks.useHotelDetail).mockReturnValue({
      data: {
        ...DETAIL_DATA,
        description: '<p>Safe text</p><script>window.hacked = true</script>',
      },
      isLoading: false,
      isError: false,
    } as any)
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    // Script should not execute / be rendered as text
    expect((window as any).hacked).toBeUndefined()
    expect(screen.getByText('Safe text')).toBeInTheDocument()
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

  it('shows bed configuration when present', () => {
    render(<HotelDetailSheet offer={liteapiOfferWithRoomDetails} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/1 King/)).toBeInTheDocument()
  })

  it('shows room amenity chips when present', () => {
    render(<HotelDetailSheet offer={liteapiOfferWithRoomDetails} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/Flat-screen TV/)).toBeInTheDocument()
    expect(screen.getByText(/Minibar/)).toBeInTheDocument()
    expect(screen.getByText(/Balcony/)).toBeInTheDocument()
  })

  it('shows room photo when room has photos', () => {
    render(<HotelDetailSheet offer={liteapiOfferWithRoomDetails} onClose={vi.fn()} onSelect={vi.fn()} />)
    const roomPhoto = screen.getAllByRole('img').find(
      (img) => (img as HTMLImageElement).src.includes('room1.jpg')
    )
    expect(roomPhoto).toBeInTheDocument()
  })

  it('does not render the "Available Rooms" section when room_types is absent', () => {
    render(<HotelDetailSheet offer={noCoordsOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText(/available rooms/i)).not.toBeInTheDocument()
  })

  // ── Two-step room selection flow ──────────────────────────────────────────

  it('clicking "Select room" highlights that room with "✓ Selected" without triggering prebook', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    const [firstSelectBtn] = screen.getAllByText('Select room')
    fireEvent.click(firstSelectBtn)
    // Button should now show "✓ Selected"
    expect(screen.getByText('✓ Selected')).toBeInTheDocument()
    // Prebook should NOT have been called yet
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('clicking the selected room again deselects it', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    const [firstSelectBtn] = screen.getAllByText('Select room')
    fireEvent.click(firstSelectBtn)
    expect(screen.getByText('✓ Selected')).toBeInTheDocument()
    // Click again to deselect
    fireEvent.click(screen.getByText('✓ Selected'))
    expect(screen.queryByText('✓ Selected')).not.toBeInTheDocument()
    expect(screen.getAllByText('Select room').length).toBe(2)
  })

  it('footer price updates to the selected room price when a room is chosen', () => {
    render(
      <HotelDetailSheet
        offer={liteapiOffer}
        checkIn="2024-05-01"
        checkOut="2024-05-05"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    // Select the Park Suite (second room) at $1200 total / 4 nights = $300/night
    const [, suiteSelectBtn] = screen.getAllByText('Select room')
    fireEvent.click(suiteSelectBtn)
    expect(screen.getAllByText(/\$300/)[0]).toBeInTheDocument()
  })

  it('footer CTA label changes to "Reserve →" when a room is selected', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('hotel-select-btn').textContent).toMatch(/Select this hotel/)
    fireEvent.click(screen.getAllByText('Select room')[0])
    expect(screen.getByTestId('hotel-select-btn').textContent).toMatch(/Reserve/)
  })

  it('clicking footer CTA after selecting a room prebooks that room and calls onSelect', async () => {
    mockMutateAsync.mockResolvedValue('PB_ROOM')
    const onSelect = vi.fn()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)

    // Step 1: select the Deluxe King Room
    fireEvent.click(screen.getAllByText('Select room')[0])

    // Step 2: click the footer CTA
    fireEvent.click(screen.getByTestId('hotel-select-btn'))

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

  it('includes lang=en parameter to request English labels', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    const iframe = document.querySelector('iframe')
    expect(iframe?.src).toContain('lang=en')
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
// GUEST REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet — guest reviews', () => {
  it('shows "Guest Reviews" section header when detail has reviews', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/guest reviews/i)).toBeInTheDocument()
  })

  it('renders a card for each review with author name and text', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Sarah M.')).toBeInTheDocument()
    expect(screen.getByText(/impeccable/)).toBeInTheDocument()
    expect(screen.getByText('James K.')).toBeInTheDocument()
    expect(screen.getByText(/panoramic views/)).toBeInTheDocument()
  })

  it('shows the review title when present', () => {
    mockDetailLoaded()
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Outstanding stay')).toBeInTheDocument()
    expect(screen.getByText('Great views')).toBeInTheDocument()
  })

  it('does not show the reviews section when reviews list is empty', () => {
    mockDetailLoaded({ reviews: [] })
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText(/guest reviews/i)).not.toBeInTheDocument()
  })

  it('does not show the reviews section when no detail data is loaded', () => {
    render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText(/guest reviews/i)).not.toBeInTheDocument()
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
// LITEAPI PREBOOK FLOW (via footer CTA, no room pre-selected)
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
