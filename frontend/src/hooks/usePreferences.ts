import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import type { TastePreferences } from '../types/user'

export function usePreferences() {
  return useQuery<TastePreferences>({
    queryKey: ['preferences'],
    queryFn: async () => {
      const { data } = await api.get<TastePreferences>('/preferences')
      return data
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

export function useUpdatePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: Partial<TastePreferences>) => api.patch('/preferences', prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['preferences'] })
      // Give the backend time to seed content matched to the new interests
      // before we invalidate the feed cache
      setTimeout(() => qc.invalidateQueries({ queryKey: ['feed'] }), 6000)
    },
  })
}
