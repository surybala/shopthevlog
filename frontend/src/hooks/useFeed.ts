import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import type { FeedPage, VlogInteraction } from '../types/vlog'

export interface FeedFilters {
  destination?: string
  style?: string
  duration?: string
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
      setTimeout(() => qc.invalidateQueries({ queryKey: ['feed'] }), 4000)
    },
  })
}
