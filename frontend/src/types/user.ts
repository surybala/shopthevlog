export interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  onboarded: boolean
  created_at: string
}

export interface TastePreferences {
  id: string
  user_id: string
  travel_styles: string[]
  destinations: string[]
  trip_durations: string[]
  budget_range: 'budget' | 'mid' | 'luxury' | null
}

export interface SocialConnection {
  id: string
  user_id: string
  platform: 'youtube' | 'instagram'
  platform_username: string | null
  connected_at: string
}
