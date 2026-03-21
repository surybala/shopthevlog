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

export function useBookHotel() {
  return useMutation({
    mutationFn: (payload: {
      rate_id: string
      guests: unknown[]
      trip_id: string
    }) => api.post('/hotels/book', payload),
  })
}
