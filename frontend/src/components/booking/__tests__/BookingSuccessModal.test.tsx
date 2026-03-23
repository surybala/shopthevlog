/**
 * Tests for BookingSuccessModal component.
 *
 * Verifies:
 *   — Renders nothing when info is null
 *   — Renders modal when info is provided
 *   — Displays correct type label (Flight / Hotel)
 *   — Shows reference, summary, and price details
 *   — Calls onClose when close button is clicked
 *   — Calls onClose when backdrop is clicked
 *   — Works for both flight and hotel types
 *   — Handles missing optional fields gracefully
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BookingSuccessModal, { type BookingSuccessInfo } from '../BookingSuccessModal'

// ─── Mock framer-motion so animations don't interfere with jsdom ──────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const flightInfo: BookingSuccessInfo = {
  type: 'flight',
  reference: 'FLREF123',
  bookingId: 'BK-FLIGHT-1',
  summary: 'JFK → NRT',
  totalAmount: '850.00',
  currency: 'USD',
}

const hotelInfo: BookingSuccessInfo = {
  type: 'hotel',
  reference: 'HTLREF456',
  bookingId: 'BK-HOTEL-1',
  summary: 'Grand Hotel Tokyo',
  totalAmount: '320.00',
  currency: 'USD',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BookingSuccessModal', () => {
  describe('when info is null', () => {
    it('renders nothing', () => {
      const { container } = render(
        <BookingSuccessModal info={null} onClose={vi.fn()} />
      )
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('when flight info is provided', () => {
    it('renders the modal', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('booking-success-modal')).toBeInTheDocument()
    })

    it('shows "Flight Booked!" heading', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByText('Flight Booked!')).toBeInTheDocument()
    })

    it('displays the booking reference', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('success-reference')).toHaveTextContent('FLREF123')
    })

    it('displays the flight route summary', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('success-summary')).toHaveTextContent('JFK → NRT')
    })

    it('displays the total price', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('success-price')).toHaveTextContent('USD')
      expect(screen.getByTestId('success-price')).toHaveTextContent('850')
    })

    it('shows "Route" label for flight type', () => {
      render(<BookingSuccessModal info={flightInfo} onClose={vi.fn()} />)
      expect(screen.getByText('Route')).toBeInTheDocument()
    })
  })

  describe('when hotel info is provided', () => {
    it('renders the modal', () => {
      render(<BookingSuccessModal info={hotelInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('booking-success-modal')).toBeInTheDocument()
    })

    it('shows "Hotel Booked!" heading', () => {
      render(<BookingSuccessModal info={hotelInfo} onClose={vi.fn()} />)
      expect(screen.getByText('Hotel Booked!')).toBeInTheDocument()
    })

    it('displays the hotel name as summary', () => {
      render(<BookingSuccessModal info={hotelInfo} onClose={vi.fn()} />)
      expect(screen.getByTestId('success-summary')).toHaveTextContent('Grand Hotel Tokyo')
    })

    it('shows "Hotel" label for hotel type', () => {
      render(<BookingSuccessModal info={hotelInfo} onClose={vi.fn()} />)
      // There's a "Hotel" label in the details row AND in "Hotel Booked!" heading
      const hotelLabels = screen.getAllByText(/^Hotel$/)
      expect(hotelLabels.length).toBeGreaterThan(0)
    })
  })

  describe('close behaviour', () => {
    it('calls onClose when the CTA button is clicked', () => {
      const onClose = vi.fn()
      render(<BookingSuccessModal info={flightInfo} onClose={onClose} />)
      fireEvent.click(screen.getByTestId('success-close-btn'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('calls onClose when the backdrop is clicked', () => {
      const onClose = vi.fn()
      render(<BookingSuccessModal info={flightInfo} onClose={onClose} />)
      fireEvent.click(screen.getByTestId('success-backdrop'))
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('optional fields', () => {
    it('renders without crashing when reference is not provided', () => {
      const infoNoRef: BookingSuccessInfo = { type: 'flight', summary: 'JFK → LAX' }
      render(<BookingSuccessModal info={infoNoRef} onClose={vi.fn()} />)
      expect(screen.getByTestId('booking-success-modal')).toBeInTheDocument()
      expect(screen.queryByTestId('success-reference')).not.toBeInTheDocument()
    })

    it('renders without crashing when summary is not provided', () => {
      const infoNoSummary: BookingSuccessInfo = { type: 'hotel', reference: 'REF-X' }
      render(<BookingSuccessModal info={infoNoSummary} onClose={vi.fn()} />)
      expect(screen.getByTestId('booking-success-modal')).toBeInTheDocument()
      expect(screen.queryByTestId('success-summary')).not.toBeInTheDocument()
    })

    it('does not render price row when totalAmount or currency is missing', () => {
      const infoNoPrice: BookingSuccessInfo = { type: 'flight', reference: 'REF-Y' }
      render(<BookingSuccessModal info={infoNoPrice} onClose={vi.fn()} />)
      expect(screen.queryByTestId('success-price')).not.toBeInTheDocument()
    })
  })
})
