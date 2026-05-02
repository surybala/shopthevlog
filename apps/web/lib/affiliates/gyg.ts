// GetYourGuide Partner API
// Docs: https://suppliers.getyourguide.com/api/
//
// GYG is the primary experience/tour affiliate. We search for activities by
// query + city, take the top result, and construct a tracked affiliate URL.

interface GYGActivity {
  activityId: number
  title: string
  url: string
  price?: number
  currency?: string
}

interface GYGLinkResult {
  affiliateUrl: string
  providerProductId: string
  title: string
}

export async function findGYGActivity(query: string, city: string): Promise<GYGLinkResult | null> {
  const apiKey = process.env.GYG_API_KEY
  const partnerId = process.env.GYG_PARTNER_ID
  if (!apiKey || !partnerId) return null

  try {
    // GYG partner search API
    const params = new URLSearchParams({ q: `${query} ${city}`, limit: '5', currency: 'USD' })
    const res = await fetch(`https://api.getyourguide.com/1/tours?${params}`, {
      headers: {
        'X-Partner-Id': partnerId,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`GYG search failed: ${res.status}`)
      return null
    }

    const data = await res.json()
    const activities: GYGActivity[] = data.data?.tours ?? []
    if (activities.length === 0) return null

    const top = activities[0]
    const activityId = String(top.activityId)

    // Affiliate URL format: /activity/{id}/?partner_id={pid}&utm_medium=online_publisher
    const affiliateUrl = `https://www.getyourguide.com/activity/${activityId}/?partner_id=${partnerId}&utm_medium=online_publisher`

    return {
      affiliateUrl,
      providerProductId: activityId,
      title: top.title,
    }
  } catch (err) {
    console.warn('GYG API error:', err)
    return null
  }
}

// Construct a GYG search fallback (no specific activity, just a destination search)
export function buildGYGFallbackUrl(query: string, city: string): string {
  const partnerId = process.env.GYG_PARTNER_ID ?? ''
  const q = encodeURIComponent(`${query} ${city}`)
  return `https://www.getyourguide.com/s/?q=${q}&partner_id=${partnerId}&utm_medium=online_publisher`
}
