import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { Vlog } from '../types/vlog'

export function useVlog(id: string) {
  return useQuery({
    queryKey: ['vlog', id],
    queryFn: async () => {
      const { data } = await api.get<Vlog>(`/vlogs/${id}`)
      return data
    },
    enabled: !!id,
  })
}

export function useVlogStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['vlog-status', id],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; itinerary_id: string | null }>(`/vlogs/${id}/status`)
      return data
    },
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'ready' || status === 'failed') return false
      return 3000 // poll every 3s while processing
    },
  })
}
