/**
 * Tests for bookingStore (Zustand) — state transitions, draft persistence,
 * open/close/reset behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useBookingStore } from '../bookingStore'
import type { FlightSearchParams, HotelSearchParams, FlightOffer, HotelOffer, Passenger } from '../../types/booking'

// ─── localStorage mock ────────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FLIGHT_PARAMS: FlightSearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  departureDate: '2026-06-01',
  returnDate: '2026-06-14',
  passengers: 1,
  cabinClass: 'economy',
}

const HOTEL_PARAMS: HotelSearchParams = {
  cityCode: 'TYO',
  checkIn: '2026-06-01',
  checkOut: '2026-06-07',
  guests: 2,
  rooms: 1,
}

const MOCK_FLIGHT_OFFER: FlightOffer = {
  id: 'flight-offer-1',
  total_amount: '850.00',
  total_currency: 'USD',
  slices: [],
  conditions: {},
}

const MOCK_HOTEL_OFFER: HotelOffer = {
  id: 'hotel-offer-1',
  hotel_name: 'Tokyo Grand',
  total_amount: '1200.00',
  total_currency: 'USD',
  check_in_date: '2026-06-01',
  check_out_date: '2026-06-07',
  rate_id: 'rate-abc',
}

const MOCK_PASSENGER: Passenger = {
  given_name: 'John',
  family_name: 'Doe',
  born_on: '1990-01-15',
  email: 'john@example.com',
  phone_number: '+1234567890',
  gender: 'male',
  title: 'mr',
}

// ─────────────────────────────────────────────────────────────────────────────

describe('bookingStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Reset store to initial state before each test
    useBookingStore.setState({
      isOpen: false,
      tab: 'flights',
      step: 'search',
      tripId: null,
      destinationLabel: null,
      flightParams: null,
      hotelParams: null,
      selectedFlightOffer: null,
      selectedHotelOffer: null,
      hotelPrebookId: null,
      passengers: [],
    })
  })

  // ── open() ──────────────────────────────────────────────────────────────────

  describe('open()', () => {
    it('sets isOpen to true', () => {
      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().isOpen).toBe(true)
    })

    it('stores the tripId', () => {
      useBookingStore.getState().open('trip-42')
      expect(useBookingStore.getState().tripId).toBe('trip-42')
    })

    it('uses default tab "flights" when not specified', () => {
      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().tab).toBe('flights')
    })

    it('accepts custom tab', () => {
      useBookingStore.getState().open('trip-1', 'hotels')
      expect(useBookingStore.getState().tab).toBe('hotels')
    })

    it('sets step to "search" when no draft exists', () => {
      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().step).toBe('search')
    })

    it('stores flightParams and hotelParams', () => {
      useBookingStore.getState().open('trip-1', 'flights', FLIGHT_PARAMS, HOTEL_PARAMS, 'Tokyo')
      const { flightParams, hotelParams, destinationLabel } = useBookingStore.getState()
      expect(flightParams).toEqual(FLIGHT_PARAMS)
      expect(hotelParams).toEqual(HOTEL_PARAMS)
      expect(destinationLabel).toBe('Tokyo')
    })

    it('clears selected offers on open', () => {
      useBookingStore.setState({
        selectedFlightOffer: MOCK_FLIGHT_OFFER,
        selectedHotelOffer: MOCK_HOTEL_OFFER,
      })
      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().selectedFlightOffer).toBeNull()
      expect(useBookingStore.getState().selectedHotelOffer).toBeNull()
    })

    it('clears hotelPrebookId on open so stale ids are never reused', () => {
      useBookingStore.setState({ hotelPrebookId: 'PB-STALE' })
      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().hotelPrebookId).toBeNull()
    })
  })

  // ── Draft persistence ────────────────────────────────────────────────────────

  describe('draft persistence', () => {
    it('restores draft on open for same tripId', () => {
      // First open → save draft
      useBookingStore.getState().open('trip-1', 'hotels', FLIGHT_PARAMS, HOTEL_PARAMS, 'Paris')
      useBookingStore.getState().saveAndClose()

      // Second open → draft restored
      useBookingStore.getState().open('trip-1')
      const state = useBookingStore.getState()
      expect(state.tab).toBe('hotels')
      expect(state.flightParams).toEqual(FLIGHT_PARAMS)
      expect(state.destinationLabel).toBe('Paris')
    })

    it('does NOT restore draft for different tripId', () => {
      useBookingStore.getState().open('trip-1', 'hotels', FLIGHT_PARAMS, null, 'Paris')
      useBookingStore.getState().saveAndClose()

      useBookingStore.getState().open('trip-2', 'flights', null, HOTEL_PARAMS, 'London')
      expect(useBookingStore.getState().tab).toBe('flights')
      expect(useBookingStore.getState().destinationLabel).toBe('London')
    })

    it('drops back to "search" when draft step is "passengers" (offers expire)', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.setState({ step: 'passengers' })
      useBookingStore.getState().saveAndClose()

      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().step).toBe('search')
    })

    it('drops back to "search" when draft step is "confirm"', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.setState({ step: 'confirm' })
      useBookingStore.getState().saveAndClose()

      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().step).toBe('search')
    })

    it('restores "results" step from draft', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.setState({ step: 'results' })
      useBookingStore.getState().saveAndClose()

      useBookingStore.getState().open('trip-1')
      expect(useBookingStore.getState().step).toBe('results')
    })

    it('saveAndClose sets isOpen to false', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.getState().saveAndClose()
      expect(useBookingStore.getState().isOpen).toBe(false)
    })
  })

  // ── close() ─────────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('sets isOpen to false', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.getState().close()
      expect(useBookingStore.getState().isOpen).toBe(false)
    })

    it('does NOT clear tripId', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.getState().close()
      expect(useBookingStore.getState().tripId).toBe('trip-1')
    })
  })

  // ── setTab() ─────────────────────────────────────────────────────────────────

  describe('setTab()', () => {
    it('changes the active tab', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.getState().setTab('hotels')
      expect(useBookingStore.getState().tab).toBe('hotels')
    })

    it('resets step to "search" on tab change', () => {
      useBookingStore.getState().open('trip-1')
      useBookingStore.setState({ step: 'results' })
      useBookingStore.getState().setTab('hotels')
      expect(useBookingStore.getState().step).toBe('search')
    })
  })

  // ── selectFlight() ───────────────────────────────────────────────────────────

  describe('selectFlight()', () => {
    it('stores the selected flight offer', () => {
      useBookingStore.getState().selectFlight(MOCK_FLIGHT_OFFER)
      expect(useBookingStore.getState().selectedFlightOffer).toEqual(MOCK_FLIGHT_OFFER)
    })

    it('advances step to "passengers"', () => {
      useBookingStore.getState().selectFlight(MOCK_FLIGHT_OFFER)
      expect(useBookingStore.getState().step).toBe('passengers')
    })
  })

  // ── selectHotel() ────────────────────────────────────────────────────────────

  describe('selectHotel()', () => {
    it('stores the selected hotel offer', () => {
      useBookingStore.getState().selectHotel(MOCK_HOTEL_OFFER)
      expect(useBookingStore.getState().selectedHotelOffer).toEqual(MOCK_HOTEL_OFFER)
    })

    it('advances step to "passengers"', () => {
      useBookingStore.getState().selectHotel(MOCK_HOTEL_OFFER)
      expect(useBookingStore.getState().step).toBe('passengers')
    })

    it('clears any stale hotelPrebookId when a new offer is selected', () => {
      useBookingStore.setState({ hotelPrebookId: 'PB-OLD' })
      useBookingStore.getState().selectHotel(MOCK_HOTEL_OFFER)
      expect(useBookingStore.getState().hotelPrebookId).toBeNull()
    })
  })

  // ── setHotelPrebookId() ───────────────────────────────────────────────────────

  describe('setHotelPrebookId()', () => {
    it('stores the prebookId', () => {
      useBookingStore.getState().setHotelPrebookId('PB-123')
      expect(useBookingStore.getState().hotelPrebookId).toBe('PB-123')
    })

    it('can be cleared back to null', () => {
      useBookingStore.getState().setHotelPrebookId('PB-123')
      useBookingStore.getState().setHotelPrebookId(null)
      expect(useBookingStore.getState().hotelPrebookId).toBeNull()
    })

    it('does not affect other store state', () => {
      useBookingStore.getState().open('trip-1', 'hotels')
      useBookingStore.getState().setHotelPrebookId('PB-999')
      expect(useBookingStore.getState().tab).toBe('hotels')
      expect(useBookingStore.getState().step).toBe('search')
    })
  })

  // ── setPassengers() ──────────────────────────────────────────────────────────

  describe('setPassengers()', () => {
    it('stores passengers list', () => {
      useBookingStore.getState().setPassengers([MOCK_PASSENGER])
      expect(useBookingStore.getState().passengers).toEqual([MOCK_PASSENGER])
    })

    it('replaces existing passengers', () => {
      useBookingStore.getState().setPassengers([MOCK_PASSENGER])
      useBookingStore.getState().setPassengers([])
      expect(useBookingStore.getState().passengers).toEqual([])
    })
  })

  // ── setStep() ────────────────────────────────────────────────────────────────

  describe('setStep()', () => {
    it('updates step without changing tab', () => {
      useBookingStore.getState().open('trip-1', 'hotels')
      useBookingStore.getState().setStep('results')
      expect(useBookingStore.getState().step).toBe('results')
      expect(useBookingStore.getState().tab).toBe('hotels')
    })
  })

  // ── reset() ──────────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears search params, offers, and passengers', () => {
      useBookingStore.getState().open('trip-1', 'flights', FLIGHT_PARAMS, HOTEL_PARAMS, 'Tokyo')
      useBookingStore.getState().selectFlight(MOCK_FLIGHT_OFFER)
      useBookingStore.getState().setPassengers([MOCK_PASSENGER])

      useBookingStore.getState().reset()

      const state = useBookingStore.getState()
      expect(state.flightParams).toBeNull()
      expect(state.hotelParams).toBeNull()
      expect(state.selectedFlightOffer).toBeNull()
      expect(state.selectedHotelOffer).toBeNull()
      expect(state.hotelPrebookId).toBeNull()
      expect(state.passengers).toEqual([])
      expect(state.step).toBe('search')
    })

    it('removes draft from localStorage', () => {
      useBookingStore.getState().open('trip-1', 'flights', FLIGHT_PARAMS)
      useBookingStore.getState().saveAndClose()

      // Draft should exist
      expect(localStorageMock.getItem('booking_draft_trip-1')).not.toBeNull()

      useBookingStore.getState().open('trip-1')
      useBookingStore.getState().reset()

      // Draft should be gone
      expect(localStorageMock.getItem('booking_draft_trip-1')).toBeNull()
    })
  })

  // ── setFlightParams / setHotelParams ─────────────────────────────────────────

  describe('setFlightParams() / setHotelParams()', () => {
    it('updates flightParams without touching other state', () => {
      useBookingStore.getState().open('trip-1', 'hotels')
      useBookingStore.getState().setFlightParams(FLIGHT_PARAMS)
      expect(useBookingStore.getState().flightParams).toEqual(FLIGHT_PARAMS)
      expect(useBookingStore.getState().tab).toBe('hotels')
    })

    it('updates hotelParams without touching other state', () => {
      useBookingStore.getState().open('trip-1', 'flights')
      useBookingStore.getState().setHotelParams(HOTEL_PARAMS)
      expect(useBookingStore.getState().hotelParams).toEqual(HOTEL_PARAMS)
      expect(useBookingStore.getState().tab).toBe('flights')
    })
  })
})
