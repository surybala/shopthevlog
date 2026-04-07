// Viator Partner API
// Docs: https://docs.viator.com/partner-api/
//
// Viator is the secondary experience affiliate (TripAdvisor-owned).
// We search for products by destination + query, take the top result,
// and construct a tracked URL with the MCID parameter.

interface ViatorProduct {
  productCode: string
  title: string
  webURL: string
  price?: { fromPrice: number; currency: string }
}

interface ViatorLinkResult {
  affiliateUrl: string
  providerProductId: string
  title: string
  priceFrom?: string
}

export async function findViatorProduct(query: string, destination: string): Promise<ViatorLinkResult | null> {
  const apiKey = process.env.VIATOR_API_KEY
  const mcid = process.env.VIATOR_MCID
  if (!apiKey || !mcid) return null

  try {
    const res = await fetch('https://api.viator.com/partner/products/search', {
      method: 'POST',
      headers: {
        'exp-api-key': apiKey,
        Accept: 'application/json;version=2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filtering: { destination, query },
        sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
        pagination: { start: 1, count: 5 },
        currency: 'USD',
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`Viator search failed: ${res.status}`)
      return null
    }

    const data = await res.json()
    const products: ViatorProduct[] = data.products ?? []
    if (products.length === 0) return null

    const top = products[0]
    const productCode = top.productCode

    // Viator affiliate URL: append mcid to the product's web URL
    const separator = top.webURL.includes('?') ? '&' : '?'
    const affiliateUrl = `${top.webURL}${separator}mcid=${mcid}`

    const price = top.price
    const priceFrom = price ? `from $${price.fromPrice.toFixed(0)}` : undefined

    return {
      affiliateUrl,
      providerProductId: productCode,
      title: top.title,
      priceFrom,
    }
  } catch (err) {
    console.warn('Viator API error:', err)
    return null
  }
}

// Search URL fallback
export function buildViatorFallbackUrl(query: string, destination: string): string {
  const mcid = process.env.VIATOR_MCID ?? ''
  const q = encodeURIComponent(`${query} ${destination}`)
  return `https://www.viator.com/search?text=${q}&mcid=${mcid}`
}
