import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { ExperienceDetail, ExperienceOffer, ExperienceSearchParams } from '../types/booking'

/**
 * Search experiences / attractions via the Booking.com Attractions API.
 *
 * Results are sorted by review score descending (highest-rated first).
 * Returns an empty array when Booking.com is unavailable or returns no results.
 *
 * Usage:
 *   const { mutateAsync: searchExperiences, data, isPending } = useExperienceSearch()
 *   const results = await searchExperiences({ location: 'Tokyo' })
 */
export function useExperienceSearch() {
  return useMutation({
    mutationFn: async (params: ExperienceSearchParams): Promise<ExperienceOffer[]> => {
      const { data } = await api.post<ExperienceOffer[]>('/experiences/search', params)
      return data
    },
  })
}

/**
 * Fetch full experience / attraction details including reviews.
 *
 * Lazily fetches when an attraction ID is provided.  Cached for 10 minutes
 * since attraction details change infrequently.
 *
 * Usage:
 *   const { data: detail, isLoading } = useExperienceDetail(attractionId)
 */
export function useExperienceDetail(attractionId: string | null | undefined) {
  return useQuery({
    queryKey: ['experience-detail', attractionId],
    queryFn: async (): Promise<ExperienceDetail> => {
      const { data } = await api.get<ExperienceDetail>(
        `/experiences/detail/${attractionId}`,
      )
      return data
    },
    enabled: !!attractionId,
    staleTime: 10 * 60 * 1000,  // 10 min — attraction details are relatively static
    retry: 1,
  })
}
