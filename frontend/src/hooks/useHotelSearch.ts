import { useMutation } from '@tanstack/react-query'
import api from '../lib/api'
import type { HotelSearchParams, HotelOffer } from '../types/booking'

export function useHotelSearch() {
  return useMutation({
    mutationFn: async (params: HotelSearchParams) => {
      const { data } = await api.post<HotelOffer[]>('/hotels/search', params)
      return data
    },
  })
}

/** Call immediately after a LiteAPI hotel offer is selected to lock in the prebookId. */
export function usePrebookHotel() {
  return useMutation({
    mutationFn: async (rate_id: string) => {
      const { data } = await api.post<{ prebook_id: string }>('/hotels/prebook', { rate_id })
      return data.prebook_id
    },
  })
}

export function useBookHotel() {
  return useMutation({
    mutationFn: (payload: {
      rate_id: string
      guests: unknown[]
      trip_id: string
      prebook_id?: string | null
    }) => api.post('/hotels/book', payload),
  })
}
