export type ActivityType = 'activity' | 'meal' | 'accommodation' | 'transport' | 'note'

export interface ItineraryActivity {
  id: string
  day_id: string
  order_index: number
  type: ActivityType
  name: string
  description: string | null
  location_name: string | null
  lat: number | null
  lng: number | null
  estimated_cost_usd: number | null
  duration_minutes: number | null
  booking_url: string | null
  image_url: string | null
}

export interface ItineraryDay {
  id: string
  itinerary_id: string
  day_number: number
  location: string | null
  title: string | null
  description: string | null
  activities: ItineraryActivity[]
}

export interface Itinerary {
  id: string
  vlog_id: string
  title: string
  summary: string | null
  total_days: number | null
  destinations: string[]
  estimated_budget_usd: number | null
  days: ItineraryDay[]
  created_at: string
}
