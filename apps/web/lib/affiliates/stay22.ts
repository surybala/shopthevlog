// Stay22 Link Management API
// Docs: https://developers.stay22.com
//
// Stay22 is the primary hotel affiliate. Given a hotel name + location,
// their API returns a managed affiliate URL that routes to the best OTA.

interface Stay22LinkResult {
  affiliateUrl: string
  providerProductId: string
  hotelName: string
  city: string
  country: string
}

interface Stay22Place {
  name: string
  city: string
  country: string
  lat?: number
  lng?: number
}

export async function createStay22Link(place: Stay22Place): Promise<Stay22LinkResult | null> {
  const apiKey = process.env.STAY22_API_KEY
  const affiliateId = process.env.STAY22_AFFILIATE_ID
  if (!apiKey || !affiliateId) return null

  try {
    const res = await fetch('https://api.stay22.com/v2/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        hotel_name: place.name,
        city: place.city,
        country: place.country,
        lat: place.lat,
        lng: place.lng,
        affiliate_id: affiliateId,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`Stay22 link creation failed: ${res.status}`)
      return null
    }

    const data = await res.json()
    // Stay22 returns: { link_id, affiliate_url, hotel_name, city, country }
    return {
      affiliateUrl: data.affiliate_url,
      providerProductId: data.link_id,
      hotelName: data.hotel_name ?? place.name,
      city: data.city ?? place.city,
      country: data.country ?? place.country,
    }
  } catch (err) {
    console.warn('Stay22 API error:', err)
    return null
  }
}

// Build a fallback deep-link for Stay22 (no API call, just URL construction)
// Used when the API isn't configured or returns no result
export function buildStay22FallbackUrl(place: Stay22Place): string {
  const affiliateId = process.env.STAY22_AFFILIATE_ID ?? ''
  const query = encodeURIComponent(`${place.name} ${place.city}`)
  return `https://www.stay22.com/search?query=${query}&aid=${affiliateId}`
}
