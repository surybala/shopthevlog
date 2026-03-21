import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { FlightSearchParams, FlightOffer } from '../types/booking'

export function useFlightSearch() {
  return useMutation({
    mutationFn: async (params: FlightSearchParams) => {
      const { data } = await api.post<FlightOffer[]>('/flights/search', params)
      return data
    },
  })
}

export function useFlightOffer(offerId: string | null) {
  return useQuery({
    queryKey: ['flight-offer', offerId],
    queryFn: async () => {
      const { data } = await api.get<FlightOffer>(`/flights/offers/${offerId}`)
      return data
    },
    enabled: !!offerId,
    staleTime: 1000 * 60, // refresh offer price every minute
  })
}

export function useBookFlight() {
  return useMutation({
    mutationFn: (payload: {
      offer_id: string
      passengers: unknown[]
      trip_id: string
    }) => api.post('/flights/book', payload),
  })
}
