import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import type { Itinerary } from '../types/itinerary'

export function useItinerary(id: string | null) {
  return useQuery({
    queryKey: ['itinerary', id],
    queryFn: async () => {
      const { data } = await api.get<Itinerary>(`/itineraries/${id}`)
      return data
    },
    enabled: !!id,
    // Itineraries are immutable once generated — cache for 30 min so revisiting
    // a vlog shows the itinerary instantly without any network round-trip.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}

export function useRegenerateItinerary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vlogId, constraints }: { vlogId: string; constraints?: Record<string, unknown> }) =>
      api.post(`/itineraries/${vlogId}/regenerate`, constraints ?? {}),
    onSuccess: (_data, { vlogId }) => {
      qc.invalidateQueries({ queryKey: ['vlog', vlogId] })
      qc.invalidateQueries({ queryKey: ['vlog-status', vlogId] })
    },
  })
}
