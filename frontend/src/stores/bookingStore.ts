import { create } from 'zustand'
import type { FlightSearchParams, HotelSearchParams, FlightOffer, HotelOffer, Passenger } from '../types/booking'

type BookingStep = 'search' | 'results' | 'passengers' | 'confirm'
type BookingTab = 'flights' | 'hotels'

// ─── Draft persistence (per trip_id in localStorage) ──────────────────────────
interface BookingDraft {
  tab: BookingTab
  step: BookingStep
  flightParams: FlightSearchParams | null
  hotelParams: HotelSearchParams | null
  destinationLabel: string | null
  passengers: Passenger[]
}

function draftKey(tripId: string) {
  return `booking_draft_${tripId}`
}

function loadDraft(tripId: string): BookingDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(tripId))
    return raw ? (JSON.parse(raw) as BookingDraft) : null
  } catch {
    return null
  }
}

function saveDraft(tripId: string, draft: BookingDraft) {
  try {
    localStorage.setItem(draftKey(tripId), JSON.stringify(draft))
  } catch { /* quota or private-mode — silently skip */ }
}

function clearDraft(tripId: string) {
  try {
    localStorage.removeItem(draftKey(tripId))
  } catch { /* ignore */ }
}

// ─── Store ─────────────────────────────────────────────────────────────────────

interface BookingState {
  isOpen: boolean
  tab: BookingTab
  step: BookingStep
  tripId: string | null
  /** Human-readable destination label shown in the drawer header (e.g. "Tokyo") */
  destinationLabel: string | null
  flightParams: FlightSearchParams | null
  hotelParams: HotelSearchParams | null
  selectedFlightOffer: FlightOffer | null
  selectedHotelOffer: HotelOffer | null
  passengers: Passenger[]
  open: (
    tripId: string,
    tab?: BookingTab,
    flightParams?: FlightSearchParams | null,
    hotelParams?: HotelSearchParams | null,
    destinationLabel?: string | null,
  ) => void
  /** Save current draft to localStorage then close the drawer. */
  saveAndClose: () => void
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

export const useBookingStore = create<BookingState>((set, get) => ({
  isOpen: false,
  tab: 'flights',
  step: 'search',
  tripId: null,
  destinationLabel: null,
  flightParams: null,
  hotelParams: null,
  selectedFlightOffer: null,
  selectedHotelOffer: null,
  passengers: [],

  open: (tripId, tab = 'flights', flightParams = null, hotelParams = null, destinationLabel = null) => {
    // Restore a previously saved draft for this trip (if any)
    const draft = loadDraft(tripId)
    if (draft) {
      set({
        isOpen: true,
        tripId,
        tab: draft.tab,
        // Don't restore 'passengers'/'confirm' step — offers expire; drop back to 'results' if there were results
        step: draft.step === 'passengers' || draft.step === 'confirm' ? 'search' : draft.step,
        flightParams: draft.flightParams ?? flightParams,
        hotelParams: draft.hotelParams ?? hotelParams,
        destinationLabel: draft.destinationLabel ?? destinationLabel,
        passengers: draft.passengers,
        selectedFlightOffer: null,
        selectedHotelOffer: null,
      })
    } else {
      set({
        isOpen: true,
        tripId,
        tab,
        step: 'search',
        flightParams,
        hotelParams,
        destinationLabel,
        selectedFlightOffer: null,
        selectedHotelOffer: null,
        passengers: [],
      })
    }
  },

  saveAndClose: () => {
    const s = get()
    if (s.tripId) {
      saveDraft(s.tripId, {
        tab: s.tab,
        step: s.step,
        flightParams: s.flightParams,
        hotelParams: s.hotelParams,
        destinationLabel: s.destinationLabel,
        passengers: s.passengers,
      })
    }
    set({ isOpen: false })
  },

  close: () => set({ isOpen: false }),

  setTab: (tab) => set({ tab, step: 'search' }),
  setStep: (step) => set({ step }),
  setFlightParams: (flightParams) => set({ flightParams }),
  setHotelParams: (hotelParams) => set({ hotelParams }),
  selectFlight: (offer) => set({ selectedFlightOffer: offer, step: 'passengers' }),
  selectHotel: (offer) => set({ selectedHotelOffer: offer, step: 'passengers' }),
  setPassengers: (passengers) => set({ passengers }),

  reset: () => {
    const { tripId } = get()
    if (tripId) clearDraft(tripId)
    set({
      step: 'search',
      flightParams: null,
      hotelParams: null,
      destinationLabel: null,
      selectedFlightOffer: null,
      selectedHotelOffer: null,
      passengers: [],
    })
  },
}))
