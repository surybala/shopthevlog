/**
 * Tests for FlightDetailSheet component.
 *
 * Verifies:
 *   - Sheet renders when an offer is provided
 *   - Sheet renders nothing when offer is null
 *   - Airline name, price, and IATA codes are displayed
 *   - Segment aircraft and times are shown
 *   - Layover pill appears between segments
 *   - Cabin class badge shows when cabinClass is provided
 *   - onClose is called by close button and backdrop click
 *   - onSelect is called with the offer when "Select" CTA is clicked
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FlightDetailSheet from '../FlightDetailSheet'
import type { FlightOffer } from '../../../types/booking'

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

const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString()

const singleSegmentOffer: FlightOffer = {
  id: 'offer-1',
  provider: 'duffel',
  total_amount: '450.00',
  total_currency: 'USD',
  expires_at: FUTURE,
  owner: { name: 'British Airways', logo_symbol_url: 'https://example.com/ba.png' },
  slices: [
    {
      origin: { iata_code: 'JFK', name: 'John F. Kennedy' },
      destination: { iata_code: 'LHR', name: 'Heathrow' },
      duration: 'PT7H30M',
      segments: [
        {
          operating_carrier: {
            name: 'British Airways',
            logo_symbol_url: 'https://example.com/ba.png',
          },
          aircraft: { name: 'Boeing 777' },
          origin: { iata_code: 'JFK' },
          destination: { iata_code: 'LHR' },
          departing_at: '2025-06-01T10:00:00',
          arriving_at: '2025-06-01T22:30:00',
        },
      ],
    },
  ],
}

const multiSegmentOffer: FlightOffer = {
  ...singleSegmentOffer,
  id: 'offer-2',
  slices: [
    {
      origin: { iata_code: 'JFK', name: 'New York' },
      destination: { iata_code: 'CDG', name: 'Paris' },
      duration: 'PT11H00M',
      segments: [
        {
          operating_carrier: { name: 'Air France', logo_symbol_url: '' },
          aircraft: { name: 'Airbus A320' },
          origin: { iata_code: 'JFK' },
          destination: { iata_code: 'BOS' },
          departing_at: '2025-06-01T08:00:00',
          arriving_at: '2025-06-01T09:30:00',
        },
        {
          operating_carrier: { name: 'Air France', logo_symbol_url: '' },
          aircraft: null,
          origin: { iata_code: 'BOS' },
          destination: { iata_code: 'CDG' },
          departing_at: '2025-06-01T11:00:00',
          arriving_at: '2025-06-01T23:00:00',
        },
      ],
    },
  ],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FlightDetailSheet', () => {
  it('renders nothing when offer is null', () => {
    const { container } = render(
      <FlightDetailSheet offer={null} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the sheet when an offer is provided', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByTestId('flight-detail-sheet')).toBeInTheDocument()
  })

  it('displays the airline name', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getAllByText('British Airways').length).toBeGreaterThan(0)
  })

  it('displays the total price', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText(/USD/)).toBeInTheDocument()
    expect(screen.getByText(/450/)).toBeInTheDocument()
  })

  it('displays origin and destination IATA codes', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getAllByText('JFK').length).toBeGreaterThan(0)
    expect(screen.getAllByText('LHR').length).toBeGreaterThan(0)
  })

  it('displays aircraft type when available', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText(/Boeing 777/)).toBeInTheDocument()
  })

  it('shows cabin class badge when cabinClass is provided', () => {
    render(
      <FlightDetailSheet
        offer={singleSegmentOffer}
        cabinClass="business"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Business')).toBeInTheDocument()
  })

  it('does not show cabin class badge when cabinClass is omitted', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.queryByText('Business')).not.toBeInTheDocument()
    expect(screen.queryByText('Economy')).not.toBeInTheDocument()
  })

  it('shows layover pill between segments', () => {
    render(
      <FlightDetailSheet offer={multiSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText(/layover in BOS/)).toBeInTheDocument()
  })

  it('does not show layover pill for single-segment slices', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.queryByText(/layover/)).not.toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={onClose} onSelect={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('flight-detail-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={onClose} onSelect={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('flight-detail-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSelect with the offer when the select button is clicked', () => {
    const onSelect = vi.fn()
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={onSelect} />
    )
    fireEvent.click(screen.getByText(/Select this flight/))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(singleSegmentOffer)
  })

  it('shows slice total duration', () => {
    render(
      <FlightDetailSheet offer={singleSegmentOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    // PT7H30M → "7h 30m"
    expect(screen.getByText('7h 30m')).toBeInTheDocument()
  })
})
