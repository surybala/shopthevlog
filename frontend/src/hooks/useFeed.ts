import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import type { FeedPage, FeedSectionsResponse, VlogInteraction } from '../types/vlog'
import type { Platform } from '../types/vlog'

export interface FeedFilters {
  destination?: string
  style?: string
  duration?: string
  platform?: Platform | ''
}

export function useFeed(filters: FeedFilters = {}) {
  return useInfiniteQuery<FeedPage>({
    queryKey: ['feed', filters],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('cursor', pageParam as string)
      if (filters.destination) params.set('destination', filters.destination)
      if (filters.style) params.set('style', filters.style)
      if (filters.duration) params.set('duration', filters.duration)
      if (filters.platform) params.set('platform', filters.platform)
      const { data } = await api.get<FeedPage>(`/feed?${params}`)
      return data
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Multi-section feed for the Discover home view.
 * Returns sections like Trending Now, For You, per-interest carousels, etc.
 */
export function useFeedSections() {
  return useQuery<FeedSectionsResponse>({
    queryKey: ['feed', 'sections'],
    queryFn: async () => {
      const { data } = await api.get<FeedSectionsResponse>('/feed/sections')
      return data
    },
    staleTime: 3 * 60 * 1000,   // 3 minutes — sections change as new content is added
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Trending vlogs — optionally filtered by platform.
 */
export function useTrending(platform?: Platform | '') {
  return useQuery<FeedPage>({
    queryKey: ['feed', 'trending', platform],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20' })
      if (platform) params.set('platform', platform)
      const { data } = await api.get<FeedPage>(`/feed/trending?${params}`)
      return data
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Live destination search — calls POST /feed/search which queries YouTube,
 * inserts new results, and returns a single deduplicated page.
 * Used when the user types a destination in the filter bar.
 */
export function useFeedSearch() {
  return useMutation({
    mutationFn: async (destination: string): Promise<FeedPage> => {
      const { data } = await api.post<FeedPage>('/feed/search', {
        destination,
        limit: 20,
      })
      return data
    },
  })
}

export function useFeedInteract() {
  return useMutation({
    mutationFn: (interaction: VlogInteraction) =>
      api.post('/feed/interact', interaction),
  })
}

export function useFeedRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/feed/refresh'),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['feed'] })
      }, 4000)
    },
  })
}
