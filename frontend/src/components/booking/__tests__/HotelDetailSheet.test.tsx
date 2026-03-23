/**
 * Tests for HotelDetailSheet component.
 *
 * Verifies:
 *   - Sheet renders when an offer is provided
 *   - Sheet renders nothing when offer is null
 *   - Hotel name, rating, address and price are displayed
 *   - Photos are rendered up to the capped limit
 *   - Provider badge shows correct label
 *   - Check-in/out dates are displayed when provided
 *   - onClose is called by close button and backdrop click
 *   - onSelect is called with the offer when "Select" CTA is clicked
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HotelDetailSheet from '../HotelDetailSheet'
import type { HotelOffer } from '../../../types/booking'

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

const liteapiOffer: HotelOffer = {
  id: 'hotel-1',
  provider: 'liteapi',
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

const duffelOffer: HotelOffer = {
  ...liteapiOffer,
  id: 'hotel-2',
  provider: 'duffel',
}

const noAddressOffer: HotelOffer = {
  ...liteapiOffer,
  id: 'hotel-3',
  accommodation: {
    ...liteapiOffer.accommodation,
    address: undefined,
    photos: [],
  },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HotelDetailSheet', () => {
  it('renders nothing when offer is null', () => {
    const { container } = render(
      <HotelDetailSheet offer={null} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the sheet when an offer is provided', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByTestId('hotel-detail-sheet')).toBeInTheDocument()
  })

  it('displays the hotel name', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText('Grand Hotel Tokyo')).toBeInTheDocument()
  })

  it('displays the total price and currency', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText(/USD/)).toBeInTheDocument()
    expect(screen.getByText(/320/)).toBeInTheDocument()
  })

  it('displays the hotel address', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText('1-2-3 Shinjuku, Tokyo 160-0022')).toBeInTheDocument()
  })

  it('does not render address section when address is absent', () => {
    render(
      <HotelDetailSheet offer={noAddressOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.queryByText(/Location/)).not.toBeInTheDocument()
  })

  it('renders hotel photos', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    const images = screen.getAllByRole('img').filter((img) =>
      (img as HTMLImageElement).src.includes('example.com/photo')
    )
    expect(images.length).toBe(2)
  })

  it('shows LiteAPI provider badge for liteapi offers', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText('LiteAPI')).toBeInTheDocument()
  })

  it('shows Duffel provider badge for duffel offers', () => {
    render(
      <HotelDetailSheet offer={duffelOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText('Duffel')).toBeInTheDocument()
  })

  it('shows star rating', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    // 5-star offer → aria-label "5 stars"
    expect(screen.getByLabelText('5 stars')).toBeInTheDocument()
  })

  it('displays check-in and check-out dates when provided', () => {
    render(
      <HotelDetailSheet
        offer={liteapiOffer}
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
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.queryByText(/Check-in/)).not.toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={onClose} onSelect={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('hotel-detail-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={onClose} onSelect={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('hotel-detail-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSelect with the offer when the select button is clicked', () => {
    const onSelect = vi.fn()
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={onSelect} />
    )
    fireEvent.click(screen.getByText(/Select this hotel/))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(liteapiOffer)
  })

  it('shows Best Available Rate label', () => {
    render(
      <HotelDetailSheet offer={liteapiOffer} onClose={vi.fn()} onSelect={vi.fn()} />
    )
    expect(screen.getByText('Best Available Rate')).toBeInTheDocument()
  })
})
