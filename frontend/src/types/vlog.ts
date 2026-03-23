export type ProcessingStatus = 'pending' | 'transcribing' | 'planning' | 'ready' | 'failed'

export interface Vlog {
  id: string
  platform: 'youtube' | 'instagram'
  platform_video_id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  video_url: string | null
  channel_name: string | null
  duration_seconds: number | null
  published_at: string | null
  view_count: number | null
  like_count: number | null
  destinations: string[]
  travel_styles: string[]
  processing_status: ProcessingStatus
  created_at: string
  itinerary_id: string | null
}

export interface FeedPage {
  vlogs: Vlog[]
  next_cursor: string | null
  total: number
}

export interface VlogInteraction {
  vlog_id: string
  action: 'view' | 'like' | 'save' | 'share' | 'book_started'
}
