type AffiliateProvider =
  | 'STAY22'
  | 'GETYOURGUIDE'
  | 'VIATOR'
  | 'AMAZON'
  | 'SKYSCANNER'
  | 'BOOKING_COM'
  | string

type AffiliateLinkLike = {
  shortCode?: string
  provider: AffiliateProvider
  affiliateUrl: string
  targetUrl: string
  providerProductId: string | null
}

type AffiliateEnv = {
  stayAid?: string
  gygId?: string
  viatorMcid?: string
  amazonTag?: string
  skyscannerId?: string
  bookingAid?: string
}

export function getOrCreateAffiliateSessionId(existing?: string | null): string {
  return existing && existing.trim() ? existing : crypto.randomUUID()
}

export function detectAffiliateDeviceType(userAgent?: string | null): 'MOBILE' | 'DESKTOP' | 'TABLET' {
  const ua = (userAgent ?? '').toLowerCase()

  if (ua.includes('ipad') || ua.includes('tablet')) return 'TABLET'
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) return 'MOBILE'
  return 'DESKTOP'
}

export function buildAffiliatePartnerRef(shortCode: string, tripKitId?: string | null) {
  return tripKitId ? `${shortCode}:${tripKitId}` : shortCode
}

export function parseAffiliatePartnerRef(partnerRef?: string | null) {
  if (!partnerRef) return { shortCode: null, tripKitId: null }
  const [shortCode, tripKitId] = partnerRef.split(':', 2)
  return {
    shortCode: shortCode || null,
    tripKitId: tripKitId || null,
  }
}

export function resolveAttributedTripKitId(input: {
  explicitTripKitId?: string | null
  linkedTripKitIds: string[]
}) {
  if (input.explicitTripKitId && input.linkedTripKitIds.includes(input.explicitTripKitId)) {
    return {
      tripKitId: input.explicitTripKitId,
      attributionMethod: 'EXACT_PARTNER_REF',
    }
  }

  if (input.linkedTripKitIds.length === 1) {
    return {
      tripKitId: input.linkedTripKitIds[0],
      attributionMethod: 'UNIQUE_LINK',
    }
  }

  return {
    tripKitId: null,
    attributionMethod: null,
  }
}

export function buildAffiliateDestination(
  link: AffiliateLinkLike,
  env: AffiliateEnv,
  options?: { tripKitId?: string | null }
) {
  switch (link.provider) {
    case 'STAY22':
      return env.stayAid && link.providerProductId
        ? `https://www.stay22.com/book/${link.providerProductId}?aid=${env.stayAid}`
        : link.affiliateUrl
    case 'GETYOURGUIDE':
      return env.gygId && link.providerProductId
        ? `https://www.getyourguide.com/activity/${link.providerProductId}/?partner_id=${env.gygId}&utm_source=vlogshopper${link.shortCode ? `&partner_ref=${encodeURIComponent(buildAffiliatePartnerRef(link.shortCode, options?.tripKitId))}` : ''}`
        : link.affiliateUrl
    case 'VIATOR':
      return env.viatorMcid ? `${link.targetUrl}?mcid=${env.viatorMcid}` : link.affiliateUrl
    case 'AMAZON':
      return env.amazonTag ? `${link.targetUrl}?tag=${env.amazonTag}` : link.affiliateUrl
    case 'SKYSCANNER':
      return env.skyscannerId ? `${link.targetUrl}&associateId=${env.skyscannerId}` : link.affiliateUrl
    case 'BOOKING_COM':
      return env.bookingAid && link.providerProductId
        ? `https://www.booking.com/hotel/${link.providerProductId}.html?aid=${env.bookingAid}`
        : link.affiliateUrl
    default:
      return link.affiliateUrl || link.targetUrl
  }
}
