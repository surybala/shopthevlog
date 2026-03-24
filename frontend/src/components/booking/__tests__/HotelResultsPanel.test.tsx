/**
 * Tests for HotelResultsPanel and the updated HotelSearch components.
 *
 * HotelResultsPanel covers:
 *  — Renders all hotel cards with name, address, price (per-night & total)
 *  — Shows result count and date range in header
 *  — Shows star rating badge (score + filled stars)
 *  — "Modify search" calls onClose
 *  — Sort: price ascending / descending / rating
 *  — Filter: max price hides expensive hotels
 *  — Filter: min stars hides low-rated hotels
 *  — Filter: provider (liteapi / duffel)
 *  — "Filtered" badge visible when any filter is active
 *  — "Clear all filters" resets everything
 *  — Empty state when no cards match active filters
 *  — Clicking a hotel card opens the detail sheet
 *  — onSelect propagated when user selects through the detail sheet
 *
 * HotelSearch covers:
 *  — Panel opens automatically on successful search
 *  — "View N results" shortcut re-opens panel after closing
 *  — Error message shown on search failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HotelResultsPanel from '../HotelResultsPanel'
import HotelSearch from '../HotelSearch'
import type { HotelOffer } from '../../../types/booking'
import { useHotelSearch as _useHotelSearch } from '../../../hooks/useHotelSearch'

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

// HotelDetailSheet is tested separately; stub it out here
vi.mock('../HotelDetailSheet', () => ({
  default: ({ offer, onSelect, onClose }: {
    offer: { accommodation: { name: string } } | null
    onSelect: (o: unknown) => void
    onClose: () => void
  }) =>
    offer ? (
      <div data-testid="hotel-detail-sheet">
        <p data-testid="detail-name">{offer.accommodation.name}</p>
        <button onClick={() => onSelect(offer)} data-testid="detail-select-btn">Select</button>
        <button onClick={onClose} data-testid="detail-close-btn">Close</button>
      </div>
    ) : null,
}))

// usePrebookHotel is only needed in the real HotelDetailSheet, which is mocked
vi.mock('../../../hooks/useHotelSearch', () => ({
  useHotelSearch: vi.fn(),
  usePrebookHotel: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useBookHotel: vi.fn(),
}))

vi.mock('../../../stores/bookingStore', () => ({
  useBookingStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    selectHotel: vi.fn(),
    setHotelParams: vi.fn(),
    hotelParams: null,
    destinationLabel: null,
  })),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const expensiveHotel: HotelOffer = {
  id: 'liteapi_hotel_expensive',
  provider: 'liteapi',
  accommodation: {
    name: 'Park Hyatt Tokyo',
    rating: 5,
    photos: [{ url: 'https://example.com/1.jpg' }],
    location: { geographic_coordinates: { latitude: 35.69, longitude: 139.7 } },
    address: '3-7-1-2 Nishi-Shinjuku, Tokyo',
  },
  cheapest_rate_total_amount: '800.00',
  cheapest_rate_currency: 'USD',
}

const midHotel: HotelOffer = {
  id: 'duffel_hotel_mid',
  provider: 'duffel',
  accommodation: {
    name: 'Shinjuku Granbell Hotel',
    rating: 3,
    photos: [],
    location: { geographic_coordinates: null },
    address: 'Shinjuku, Tokyo',
  },
  cheapest_rate_total_amount: '200.00',
  cheapest_rate_currency: 'USD',
}

const cheapHotel: HotelOffer = {
  id: 'liteapi_hotel_cheap',
  provider: 'liteapi',
  accommodation: {
    name: 'Budget Capsule Inn',
    rating: 2,
    photos: [],
    location: { geographic_coordinates: null },
    address: 'Shinjuku, Tokyo',
  },
  cheapest_rate_total_amount: '80.00',
  cheapest_rate_currency: 'USD',
}

const noRatingHotel: HotelOffer = {
  id: 'duffel_hotel_no_rating',
  provider: 'duffel',
  accommodation: {
    name: 'Mystery Hotel',
    rating: null,
    photos: [],
    location: { geographic_coordinates: null },
  },
  cheapest_rate_total_amount: '150.00',
  cheapest_rate_currency: 'USD',
}

const ALL_OFFERS = [expensiveHotel, midHotel, cheapHotel, noRatingHotel]

const BASE_PROPS = {
  offers: ALL_OFFERS,
  checkIn: '2024-05-01',
  checkOut: '2024-05-05',
  onClose: vi.fn(),
  onSelect: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── HotelResultsPanel ────────────────────────────────────────────────────────

describe('HotelResultsPanel — rendering', () => {
  it('renders all hotel names', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText('Park Hyatt Tokyo')).toBeInTheDocument()
    expect(screen.getByText('Shinjuku Granbell Hotel')).toBeInTheDocument()
    expect(screen.getByText('Budget Capsule Inn')).toBeInTheDocument()
    expect(screen.getByText('Mystery Hotel')).toBeInTheDocument()
  })

  it('shows result count in header', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText(/4.*properties/i)).toBeInTheDocument()
  })

  it('shows date range in header', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText(/May 1/)).toBeInTheDocument()
    expect(screen.getByText(/May 5/)).toBeInTheDocument()
  })

  it('shows nights count in header', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText(/4 nights/)).toBeInTheDocument()
  })

  it('shows per-night price when dates are provided', () => {
    // expensiveHotel: $800 / 4 nights = $200/night
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getAllByText(/\/night/)[0]).toBeInTheDocument()
  })

  it('shows star rating badge for rated hotels', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    // expensiveHotel has rating 5.0 → badge shows "5.0"
    expect(screen.getByText('5.0')).toBeInTheDocument()
  })

  it('shows address when available', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText(/Nishi-Shinjuku/)).toBeInTheDocument()
  })

  it('shows the "Modify search" back button', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.getByText('Modify search')).toBeInTheDocument()
  })
})

describe('HotelResultsPanel — navigation', () => {
  it('calls onClose when "Modify search" is clicked', () => {
    const onClose = vi.fn()
    render(<HotelResultsPanel {...BASE_PROPS} onClose={onClose} />)
    fireEvent.click(screen.getByText('Modify search'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens the detail sheet when a hotel card is clicked', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.queryByTestId('hotel-detail-sheet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId(`hotel-card-${expensiveHotel.id}`))
    expect(screen.getByTestId('hotel-detail-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('detail-name')).toHaveTextContent('Park Hyatt Tokyo')
  })

  it('calls onSelect with the offer when "Select" is clicked in the detail sheet', async () => {
    const onSelect = vi.fn()
    render(<HotelResultsPanel {...BASE_PROPS} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId(`hotel-card-${expensiveHotel.id}`))
    fireEvent.click(screen.getByTestId('detail-select-btn'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expensiveHotel))
  })

  it('closes the detail sheet without selecting when "Close" is clicked', () => {
    const onSelect = vi.fn()
    render(<HotelResultsPanel {...BASE_PROPS} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId(`hotel-card-${expensiveHotel.id}`))
    fireEvent.click(screen.getByTestId('detail-close-btn'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByTestId('hotel-detail-sheet')).not.toBeInTheDocument()
  })
})

describe('HotelResultsPanel — sorting', () => {
  function getNamesInOrder() {
    return screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
  }

  it('sorts by price ascending', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByText('Price: low to high'))
    const names = getNamesInOrder()
    // cheapest first: $80, $150, $200, $800
    expect(names[0]).toBe('Budget Capsule Inn')
    expect(names[3]).toBe('Park Hyatt Tokyo')
  })

  it('sorts by price descending', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByText('Price: high to low'))
    const names = getNamesInOrder()
    expect(names[0]).toBe('Park Hyatt Tokyo')
    expect(names[3]).toBe('Budget Capsule Inn')
  })

  it('sorts by star rating descending', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByText('Star rating'))
    const names = getNamesInOrder()
    // rating 5, 3, 2, null → Park Hyatt first
    expect(names[0]).toBe('Park Hyatt Tokyo')
  })
})

describe('HotelResultsPanel — filtering', () => {
  it('max-price slider hides hotels above the threshold', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    // Range max is ceil($800/50)*50 = 800
    // Set max to 250 → should hide Park Hyatt ($800)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '250' } })
    expect(screen.queryByText('Park Hyatt Tokyo')).not.toBeInTheDocument()
    expect(screen.getByText('Shinjuku Granbell Hotel')).toBeInTheDocument()
  })

  it('star rating filter hides hotels below threshold', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    // Click the sidebar "4★+" button (data-testid avoids ambiguity with mobile bar)
    fireEvent.click(screen.getByTestId('filter-stars-4'))
    // Only 5-star Park Hyatt should remain
    expect(screen.getByText('Park Hyatt Tokyo')).toBeInTheDocument()
    expect(screen.queryByText('Shinjuku Granbell Hotel')).not.toBeInTheDocument()
    expect(screen.queryByText('Budget Capsule Inn')).not.toBeInTheDocument()
  })

  it('provider filter "LiteAPI" shows only liteapi hotels', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('filter-provider-liteapi'))
    expect(screen.getByText('Park Hyatt Tokyo')).toBeInTheDocument()
    expect(screen.getByText('Budget Capsule Inn')).toBeInTheDocument()
    expect(screen.queryByText('Shinjuku Granbell Hotel')).not.toBeInTheDocument()
  })

  it('provider filter "Duffel" shows only duffel hotels', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('filter-provider-duffel'))
    expect(screen.getByText('Shinjuku Granbell Hotel')).toBeInTheDocument()
    expect(screen.queryByText('Park Hyatt Tokyo')).not.toBeInTheDocument()
  })

  it('shows "Filtered" badge when any filter is active', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    expect(screen.queryByText('Filtered')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('filter-provider-liteapi'))
    expect(screen.getByText('Filtered')).toBeInTheDocument()
  })

  it('"Clear all filters" resets and shows all hotels', () => {
    render(<HotelResultsPanel {...BASE_PROPS} />)
    // Apply a filter
    fireEvent.click(screen.getByTestId('filter-provider-liteapi'))
    expect(screen.queryByText('Shinjuku Granbell Hotel')).not.toBeInTheDocument()
    // Clear
    fireEvent.click(screen.getByText('✕ Clear all filters'))
    expect(screen.getByText('Shinjuku Granbell Hotel')).toBeInTheDocument()
    expect(screen.queryByText('Filtered')).not.toBeInTheDocument()
  })

  it('shows empty state when no hotels match active filters', () => {
    // Set min stars to 5 — only Park Hyatt qualifies, then set provider to Duffel
    render(<HotelResultsPanel {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('filter-stars-5'))
    fireEvent.click(screen.getByTestId('filter-provider-duffel'))
    // Now 0 hotels match (5★ duffel doesn't exist in our fixtures)
    expect(screen.getByText(/No properties match your filters/)).toBeInTheDocument()
  })
})

// ─── HotelSearch — panel launch behaviour ─────────────────────────────────────

describe('HotelSearch — panel launch', () => {
  const useHotelSearch = vi.mocked(_useHotelSearch)

  function makeSearchHook(overrides: Partial<{
    isPending: boolean
    data: HotelOffer[] | undefined
    isError: boolean
    error: Error | null
    mutate: ReturnType<typeof vi.fn>
  }> = {}) {
    return {
      isPending: false,
      data: undefined,
      isError: false,
      error: null,
      mutate: vi.fn(),
      ...overrides,
    }
  }

  it('panel is hidden before any search', () => {
    useHotelSearch.mockReturnValue(makeSearchHook())
    render(<HotelSearch />)
    expect(screen.queryByTestId('hotel-results-panel')).not.toBeInTheDocument()
  })

  it('panel opens automatically when search returns results', async () => {
    let successCallback: (() => void) | undefined
    const mutate = vi.fn().mockImplementation((_params, opts) => {
      successCallback = opts?.onSuccess
    })
    useHotelSearch.mockReturnValue(makeSearchHook({ mutate, data: [expensiveHotel] }))

    render(<HotelSearch />)
    // Use fireEvent.submit on the form to bypass HTML5 required-field validation
    const submitBtn = screen.getByRole('button', { name: /Search Hotels/i })
    fireEvent.submit(submitBtn.closest('form')!)
    // Trigger the onSuccess callback
    successCallback?.()
    await waitFor(() =>
      expect(screen.getByTestId('hotel-results-panel')).toBeInTheDocument()
    )
  })

  it('"View N results" shortcut appears after panel is closed', async () => {
    let successCallback: (() => void) | undefined
    const mutate = vi.fn().mockImplementation((_params, opts) => {
      successCallback = opts?.onSuccess
    })
    useHotelSearch.mockReturnValue(makeSearchHook({ mutate, data: [expensiveHotel, midHotel] }))

    render(<HotelSearch />)
    const submitBtn = screen.getByRole('button', { name: /Search Hotels/i })
    fireEvent.submit(submitBtn.closest('form')!)
    successCallback?.()

    // Close the panel
    await waitFor(() => screen.getByTestId('hotel-results-panel'))
    fireEvent.click(screen.getByText('Modify search'))

    expect(screen.queryByTestId('hotel-results-panel')).not.toBeInTheDocument()
    expect(screen.getByText(/View 2 results/)).toBeInTheDocument()
  })

  it('shows error message on search failure', () => {
    useHotelSearch.mockReturnValue(
      makeSearchHook({ isError: true, error: new Error('Hotel search failed') })
    )
    render(<HotelSearch />)
    expect(screen.getByText('Hotel search failed')).toBeInTheDocument()
  })
})
