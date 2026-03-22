import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import api from '../lib/api'
import type { FeedPage, VlogInteraction } from '../types/vlog'

interface FeedFilters {
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
    // Keep feed data fresh for 5 minutes — navigating away and back is instant
    staleTime: 5 * 60 * 1000,
    // Hold pages in memory for 10 minutes after the component unmounts
    gcTime: 10 * 60 * 1000,
    // Don't trigger a background refetch every time the user alt-tabs back
    refetchOnWindowFocus: false,
  })
}

export function useFeedInteract() {
  return useMutation({
    mutationFn: (interaction: VlogInteraction) =>
      api.post('/feed/interact', interaction),
  })
}

export function useFeedRefresh() {
  return useMutation({
    mutationFn: () => api.post('/feed/refresh'),
  })
}
