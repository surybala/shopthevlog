import { useMutation } from '@tanstack/react-query'
import api from '../lib/api'
import type { CarOffer, CarSearchParams } from '../types/booking'

/**
 * Search car rentals via the Booking.com Cars API.
 *
 * Returns a list of CarOffer objects sorted by total price ascending.
 * Returns an empty array (not an error) when Booking.com is unavailable
 * or returns no results for the given search parameters.
 *
 * Usage:
 *   const { mutateAsync: searchCars, data: carResults, isPending } = useCarSearch()
 *   const results = await searchCars({ pickup_location: 'Tokyo', ... })
 */
export function useCarSearch() {
  return useMutation({
    mutationFn: async (params: CarSearchParams): Promise<CarOffer[]> => {
      const { data } = await api.post<CarOffer[]>('/cars/search', params)
      return data
    },
  })
}
