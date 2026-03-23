/**
 * Tests for HotelDetailSheet component.
 *
 * Verifies:
 *   — Basic rendering (name, rating, address, price, photos, badges, dates)
 *   — onClose fired by close button and backdrop click
 *   — Duffel offers: onSelect called immediately without prebook
 *   — LiteAPI offers: prebook called first, prebookId stored, then onSelect
 *   — LiteAPI offers: 409 prebook error → toast + onClose, no onSelect
 *   — LiteAPI offers: other prebook error → toast, no onSelect
 *   — Loading state while prebook is in flight
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HotelDetailSheet from '../HotelDetailSheet'
import type { HotelOffer } from '../../../types/booking'
import { useBookingStore } from '../../../stores/bookingStore'
import { ApiError } from '../../../lib/api'

// ─── Mock framer-motion so animations don't interfere with jsdom ──────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ─── Mock react-hot-toast ─────────────────────────────────────────────────────
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}))

// ─── Mock usePrebookHotel — prevents React Query context requirement ──────────
const mockMutateAsync = vi.fn()
vi.mock('../../../hooks/useHotelSearch', () => ({
  usePrebookHotel: vi.fn(),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** ID does NOT start with "liteapi_hotel_" → prebook is skipped for this offer. */
const duffelOffer: HotelOffer = {
  id: 'duffel-hotel-1',
  provider: 'duffel',
  accommodation: {
    name: 'Grand Hotel Tokyo',
    rating: 5,
    photos: [
      { url: 'https://example.com/photo1.jpg' },
      { url: 'https://example.com/photo2.jpg' },
    ],
    location: {
      geographic_coordinates: { latitude: 35.6762, longitude: 139.6503 },
    },
    address: '1-2-3 Shinjuku, Tokyo 160-0022',
  },
  cheapest_rate_total_amount: '320.00',
  cheapest_rate_currency: 'USD',
}

/** ID starts with "liteapi_hotel_" → triggers the prebook step. */
const liteapiOffer: HotelOffer = {
  ...duffelOffer,
  id: 'liteapi_hotel_RATE_XYZ',
  provider: 'liteapi',
}

const noAddressOffer: HotelOffer = {
  ...duffelOffer,
  accommodation: { ...duffelOffer.accommodation, address: undefined, photos: [] },
}

// ─── Setup ────────────────────────────────────────────────────────────────────

// Import the mocked module so we can configure it per-test
import * as HotelSearchHooks from '../../../hooks/useHotelSearch'
import toast from 'react-hot-toast'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: prebook succeeds immediately
  vi.mocked(HotelSearchHooks.usePrebookHotel).mockReturnValue({
    mutateAsync: mockMutateAsync.mockResolvedValue('PB-DEFAULT'),
    isPending: false,
  } as any)
  // Reset the Zustand store
  useBookingStore.setState({ hotelPrebookId: null })
})

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('HotelDetailSheet', () => {
  describe('rendering', () => {
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

    it('displays the total price and currency', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText(/USD/)).toBeInTheDocument()
      expect(screen.getByText(/320/)).toBeInTheDocument()
    })

    it('displays the hotel address', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText('1-2-3 Shinjuku, Tokyo 160-0022')).toBeInTheDocument()
    })

    it('does not render address section when address is absent', () => {
      render(<HotelDetailSheet offer={noAddressOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.queryByText(/Location/)).not.toBeInTheDocument()
    })

    it('renders hotel photos', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      const images = screen.getAllByRole('img').filter((img) =>
        (img as HTMLImageElement).src.includes('example.com/photo')
      )
      expect(images.length).toBe(2)
    })

    it('shows LiteAPI provider badge for liteapi offers', () => {
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText('LiteAPI')).toBeInTheDocument()
    })

    it('shows Duffel provider badge for duffel offers', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText('Duffel')).toBeInTheDocument()
    })

    it('shows star rating', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByLabelText('5 stars')).toBeInTheDocument()
    })

    it('displays check-in and check-out dates when provided', () => {
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

    it('does not render stay section when check-in/out are not provided', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.queryByText(/Check-in/)).not.toBeInTheDocument()
    })

    it('shows Best Available Rate label', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText('Best Available Rate')).toBeInTheDocument()
    })

    it('shows "Confirming offer…" and disables button when prebook is pending', () => {
      vi.mocked(HotelSearchHooks.usePrebookHotel).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as any)
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      expect(screen.getByText('Confirming offer…')).toBeInTheDocument()
      expect(screen.getByTestId('hotel-select-btn')).toBeDisabled()
    })
  })

  // ── Close behaviour ──────────────────────────────────────────────────────────

  describe('close behaviour', () => {
    it('calls onClose when the close button is clicked', () => {
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

  // ── Duffel offers — no prebook ────────────────────────────────────────────────

  describe('Duffel offer selection (no prebook)', () => {
    it('calls onSelect immediately without calling prebook', () => {
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(onSelect).toHaveBeenCalledOnce()
      expect(onSelect).toHaveBeenCalledWith(duffelOffer)
    })

    it('does not write hotelPrebookId to the store', () => {
      render(<HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      expect(useBookingStore.getState().hotelPrebookId).toBeNull()
    })
  })

  // ── LiteAPI offers — prebook required ────────────────────────────────────────

  describe('LiteAPI offer selection (prebook required)', () => {
    it('calls usePrebookHotel.mutateAsync with the offer id', async () => {
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith('liteapi_hotel_RATE_XYZ'))
    })

    it('stores the returned prebookId in the booking store before calling onSelect', async () => {
      mockMutateAsync.mockResolvedValue('PB-RETURNED')
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      await waitFor(() => {
        expect(useBookingStore.getState().hotelPrebookId).toBe('PB-RETURNED')
        expect(onSelect).toHaveBeenCalledWith(liteapiOffer)
      })
    })

    it('calls onSelect after prebook succeeds', async () => {
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      await waitFor(() => expect(onSelect).toHaveBeenCalledOnce())
    })

    it('shows a stale-offer toast and calls onClose when prebook returns 409', async () => {
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

    it('shows a generic toast (no close) when prebook fails with a non-409 error', async () => {
      mockMutateAsync.mockRejectedValue(new ApiError('Network error', 502))
      const onClose = vi.fn()
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={liteapiOffer} onClose={onClose} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('try again'),
          // no duration option for generic error
        )
        expect(onClose).not.toHaveBeenCalled()
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    it('does not call onSelect when prebook fails', async () => {
      mockMutateAsync.mockRejectedValue(new ApiError('Fail', 500))
      const onSelect = vi.fn()
      render(<HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />)
      fireEvent.click(screen.getByTestId('hotel-select-btn'))
      await waitFor(() => expect(toast.error).toHaveBeenCalled())
      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
