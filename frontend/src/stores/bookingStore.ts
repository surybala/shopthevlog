import { create } from 'zustand'
import type { FlightSearchParams, HotelSearchParams, FlightOffer, HotelOffer, Passenger } from '../types/booking'

type BookingStep = 'search' | 'results' | 'passengers' | 'confirm'
type BookingTab = 'flights' | 'hotels'

interface BookingState {
  isOpen: boolean
  tab: BookingTab
  step: BookingStep
  tripId: string | null
  flightParams: FlightSearchParams | null
  hotelParams: HotelSearchParams | null
  selectedFlightOffer: FlightOffer | null
  selectedHotelOffer: HotelOffer | null
  passengers: Passenger[]
  open: (tripId: string, tab?: BookingTab) => void
  close: () => void
  setTab: (tab: BookingTab) => void
  setStep: (step: BookingStep) => void
  setFlightParams: (params: FlightSearchParams) => void
  setHotelParams: (params: HotelSearchParams) => void
  selectFlight: (offer: FlightOffer) => void
  selectHotel: (offer: HotelOffer) => void
  setPassengers: (passengers: Passenger[]) => void
  reset: () => void
}

export const useBookingStore = create<BookingState>((set) => ({
  isOpen: false,
  tab: 'flights',
  step: 'search',
  tripId: null,
  flightParams: null,
  hotelParams: null,
  selectedFlightOffer: null,
  selectedHotelOffer: null,
  passengers: [],
  open: (tripId, tab = 'flights') => set({ isOpen: true, tripId, tab, step: 'search' }),
  close: () => set({ isOpen: false }),
  setTab: (tab) => set({ tab, step: 'search' }),
  setStep: (step) => set({ step }),
  setFlightParams: (flightParams) => set({ flightParams }),
  setHotelParams: (hotelParams) => set({ hotelParams }),
  selectFlight: (offer) => set({ selectedFlightOffer: offer, step: 'passengers' }),
  selectHotel: (offer) => set({ selectedHotelOffer: offer, step: 'passengers' }),
  setPassengers: (passengers) => set({ passengers }),
  reset: () => set({
    step: 'search',
    flightParams: null,
    hotelParams: null,
    selectedFlightOffer: null,
    selectedHotelOffer: null,
    passengers: [],
  }),
}))
