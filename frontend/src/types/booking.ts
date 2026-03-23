export interface Trip {
  id: string
  user_id: string
  itinerary_id: string | null
  vlog_id: string | null
  name: string
  status: 'planning' | 'booked' | 'completed' | 'cancelled'
  start_date: string | null
  end_date: string | null
  traveller_count: number
  notes: string | null
  created_at: string
}

// ── Search / form parameter types (used by booking store & search forms) ───────

export interface FlightSearchParams {
  origin: string          // IATA code
  destination: string     // IATA code
  departure_date: string  // ISO date
  return_date?: string
  passengers: number
  cabin_class: 'economy' | 'premium_economy' | 'business' | 'first'
}

export interface HotelSearchParams {
  location: string
  check_in: string
  check_out: string
  guests: number
  rooms: number
}

// ── Booking metadata (stored in `search_params` column, returned from API) ────

export interface FlightSliceMeta {
  origin: string | null
  destination: string | null
  departing_at: string | null
  arriving_at: string | null
  airline: string | null
}

/** Structured flight info extracted from the Duffel order and stored at booking time. */
export interface FlightBookingMeta {
  origin: string | null
  destination: string | null
  slices: FlightSliceMeta[]
}

/** Structured hotel info sent from the frontend at booking time. */
export interface HotelBookingMeta {
  hotel_name: string | null
  check_in: string | null
  check_out: string | null
  hotel_address: string | null
  hotel_rating: number | null
}

// ── Booking ────────────────────────────────────────────────────────────────────

export interface PassengerDetail {
  title: string
  given_name: string
  family_name: string
  email: string
  phone_number: string
}

export interface Booking {
  id: string
  trip_id: string
  booking_type: 'flight' | 'hotel'
  duffel_booking_reference: string | null
  status: 'pending' | 'confirmed' | 'cancelled' | 'failed'
  total_amount: number | null
  currency: string
  booked_at: string | null
  created_at: string
  provider: string | null
  passenger_details: PassengerDetail[] | null
  search_params: FlightBookingMeta | HotelBookingMeta | null
}

// ── Offer types ────────────────────────────────────────────────────────────────

export interface FlightOffer {
  id: string
  provider?: 'duffel'
  total_amount: string
  total_currency: string
  expires_at: string
  owner: { name: string; logo_symbol_url: string }
  slices: Array<{
    origin: { iata_code: string; name: string }
    destination: { iata_code: string; name: string }
    duration: string
    // Duffel v2: these may be absent at the slice level — prefer segments[0]
    departing_at?: string
    arriving_at?: string
    segments: Array<{
      operating_carrier: { name: string; logo_symbol_url: string }
      aircraft: { name: string } | null
      origin: { iata_code: string }
      destination: { iata_code: string }
      departing_at: string
      arriving_at: string
    }>
  }>
}

export interface HotelOffer {
  id: string
  provider: 'liteapi' | 'duffel'
  accommodation: {
    name: string
    rating: number | null
    photos: Array<{ url: string }>
    location: { geographic_coordinates: { latitude: number; longitude: number } | null }
    address?: string
  }
  cheapest_rate_total_amount: string
  cheapest_rate_currency: string
}

export interface Passenger {
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr'
  given_name: string
  family_name: string
  gender: 'male' | 'female'
  born_on: string  // ISO date
  email: string
  phone_number: string
}
