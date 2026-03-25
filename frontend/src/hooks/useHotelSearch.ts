import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { HotelOffer, HotelSearchParams, HotelDetail } from '../types/booking'

export function useHotelSearch() {
  return useMutation({
    mutationFn: async (params: HotelSearchParams) => {
      const { data } = await api.post<HotelOffer[]>('/hotels/search', params)
      return data
    },
  })
}

/**
 * Lazily fetch rich hotel details (description, amenities, all photos, review score).
 * Only enabled for LiteAPI hotels — Duffel doesn't have an equivalent detail endpoint.
 *
 * Pass hotelName + lat/lng to enable Google Places / Foursquare photo & review enrichment.
 */
export function useHotelDetail(
  hotelId: string | null | undefined,
  provider: string,
  hotelName?: string | null,
  lat?: number | null,
  lng?: number | null,
) {
  return useQuery({
    queryKey: ['hotel-detail', provider, hotelId, hotelName, lat, lng],
    queryFn: async () => {
      const params: Record<string, string | number> = { hotel_id: hotelId!, provider }
      if (hotelName) params.hotel_name = hotelName
      if (lat != null) params.lat = lat
      if (lng != null) params.lng = lng
      const { data } = await api.get<HotelDetail>('/hotels/detail', { params })
      return data
    },
    enabled: !!hotelId && provider === 'liteapi',
    staleTime: 5 * 60 * 1000,   // 5 min — details don't change often
    retry: 1,
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
      // Structured metadata stored so TripDetail can show hotel details
      hotel_name?: string | null
      check_in?: string | null
      check_out?: string | null
      hotel_address?: string | null
      hotel_rating?: number | null
    }) => api.post('/hotels/book', payload),
  })
}
