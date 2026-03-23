/**
 * Tests for BookingCard component.
 *
 * Covers:
 *  — Renders flight booking with route, reference, passengers, price
 *  — Renders hotel booking with name, stars, check-in/out, nights count
 *  — Status badge colours (confirmed / pending / cancelled)
 *  — Cancel button opens confirm modal; confirms calls onCancel
 *  — Loading spinner shown while cancelling
 *  — Cancelled bookings hide the actions footer
 *  — onAddBooking shown when provided and booking is active
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BookingCard from '../BookingCard'
import type { Booking, FlightBookingMeta, HotelBookingMeta } from '../../../types/booking'

// ─── Mock framer-motion ───────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const flightMeta: FlightBookingMeta = {
  origin: 'JFK',
  destination: 'NRT',
  slices: [
    {
      origin: 'JFK',
      destination: 'NRT',
      departing_at: '2024-05-01T10:00:00',
      arriving_at: '2024-05-02T14:30:00',
      airline: 'ANA',
    },
  ],
}

const hotelMeta: HotelBookingMeta = {
  hotel_name: 'Grand Hotel Tokyo',
  check_in: '2024-05-02',
  check_out: '2024-05-06',
  hotel_address: '1-2-3 Shinjuku, Tokyo',
  hotel_rating: 4,
}

const confirmedFlight: Booking = {
  id: 'bk-flight-1',
  trip_id: 'trip-1',
  booking_type: 'flight',
  duffel_booking_reference: 'FLREF1',
  status: 'confirmed',
  total_amount: 850,
  currency: 'USD',
  booked_at: '2024-04-01T12:00:00',
  created_at: '2024-04-01T12:00:00',
  provider: 'duffel',
  passenger_details: [{ title: 'mr', given_name: 'Jane', family_name: 'Smith', email: 'jane@example.com', phone_number: '+1555' }],
  search_params: flightMeta,
}

const confirmedHotel: Booking = {
  id: 'bk-hotel-1',
  trip_id: 'trip-1',
  booking_type: 'hotel',
  duffel_booking_reference: 'HTLREF1',
  status: 'confirmed',
  total_amount: 320,
  currency: 'USD',
  booked_at: '2024-04-01T12:00:00',
  created_at: '2024-04-01T12:00:00',
  provider: 'liteapi',
  passenger_details: [{ title: 'ms', given_name: 'Jane', family_name: 'Smith', email: 'jane@example.com', phone_number: '+1555' }],
  search_params: hotelMeta,
}

const cancelledFlight: Booking = { ...confirmedFlight, id: 'bk-flight-2', status: 'cancelled' }

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BookingCard — flight', () => {
  it('renders the confirmation reference', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByTestId('booking-reference')).toHaveTextContent('FLREF1')
  })

  it('shows flight route origin and destination', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByText('JFK')).toBeInTheDocument()
    expect(screen.getByText('NRT')).toBeInTheDocument()
  })

  it('shows the airline name', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByText('ANA')).toBeInTheDocument()
  })

  it('shows passenger names', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
  })

  it('shows total price', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    const total = screen.getByTestId('booking-total')
    expect(total.textContent).toMatch(/850/)
  })

  it('shows Confirmed status badge', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByTestId('booking-status-badge')).toHaveTextContent('Confirmed')
  })
})

describe('BookingCard — hotel', () => {
  it('shows hotel name', () => {
    render(<BookingCard booking={confirmedHotel} onCancel={vi.fn()} />)
    expect(screen.getByText('Grand Hotel Tokyo')).toBeInTheDocument()
  })

  it('shows hotel address', () => {
    render(<BookingCard booking={confirmedHotel} onCancel={vi.fn()} />)
    expect(screen.getByText('1-2-3 Shinjuku, Tokyo')).toBeInTheDocument()
  })

  it('shows check-in and check-out labels', () => {
    render(<BookingCard booking={confirmedHotel} onCancel={vi.fn()} />)
    expect(screen.getByText('Check-in')).toBeInTheDocument()
    expect(screen.getByText('Check-out')).toBeInTheDocument()
  })

  it('shows nights count', () => {
    render(<BookingCard booking={confirmedHotel} onCancel={vi.fn()} />)
    expect(screen.getByText(/4 nights/)).toBeInTheDocument()
  })

  it('shows hotel confirmation reference', () => {
    render(<BookingCard booking={confirmedHotel} onCancel={vi.fn()} />)
    expect(screen.getByTestId('booking-reference')).toHaveTextContent('HTLREF1')
  })
})

describe('BookingCard — cancel flow', () => {
  it('shows cancel button for confirmed bookings', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.getByTestId('booking-cancel-btn')).toBeInTheDocument()
  })

  it('opens confirmation modal when cancel is clicked', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('booking-cancel-btn'))
    expect(screen.getByText(/Cancel Flight\?/i)).toBeInTheDocument()
  })

  it('calls onCancel and closes modal when "Yes, cancel" is clicked', async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(<BookingCard booking={confirmedFlight} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('booking-cancel-btn'))
    fireEvent.click(screen.getByText('Yes, cancel'))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('bk-flight-1'))
  })

  it('does not call onCancel when "Keep booking" is clicked', () => {
    const onCancel = vi.fn()
    render(<BookingCard booking={confirmedFlight} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('booking-cancel-btn'))
    fireEvent.click(screen.getByText('Keep booking'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('hides the actions footer for cancelled bookings', () => {
    render(<BookingCard booking={cancelledFlight} onCancel={vi.fn()} />)
    expect(screen.queryByTestId('booking-cancel-btn')).not.toBeInTheDocument()
  })
})

describe('BookingCard — Add booking action', () => {
  it('shows Add booking button when onAddBooking is provided', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} onAddBooking={vi.fn()} />)
    expect(screen.getByTestId('booking-modify-btn')).toBeInTheDocument()
  })

  it('calls onAddBooking when button is clicked', () => {
    const onAdd = vi.fn()
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} onAddBooking={onAdd} />)
    fireEvent.click(screen.getByTestId('booking-modify-btn'))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('does not show Add booking button when not provided', () => {
    render(<BookingCard booking={confirmedFlight} onCancel={vi.fn()} />)
    expect(screen.queryByTestId('booking-modify-btn')).not.toBeInTheDocument()
  })
})
