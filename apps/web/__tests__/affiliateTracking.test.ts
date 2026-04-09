import { describe, expect, it, vi } from 'vitest'
import {
  buildAffiliatePartnerRef,
  buildAffiliateDestination,
  detectAffiliateDeviceType,
  getOrCreateAffiliateSessionId,
  parseAffiliatePartnerRef,
  resolveAttributedTripKitId,
} from '@/lib/affiliateTracking'

describe('affiliate tracking helpers', () => {
  it('reuses an existing session id or creates a new one', () => {
    expect(getOrCreateAffiliateSessionId('session-1')).toBe('session-1')

    const randomUuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('generated-session')
    expect(getOrCreateAffiliateSessionId(null)).toBe('generated-session')
    randomUuidSpy.mockRestore()
  })

  it('detects device type from the user agent', () => {
    expect(detectAffiliateDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile')).toBe('MOBILE')
    expect(detectAffiliateDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('TABLET')
    expect(detectAffiliateDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('DESKTOP')
  })

  it('builds provider-specific destination URLs', () => {
    expect(
      buildAffiliateDestination(
        {
          shortCode: 'SHORT1',
          provider: 'GETYOURGUIDE',
          affiliateUrl: 'https://gyg.example/fallback',
          targetUrl: 'https://gyg.example/fallback',
          providerProductId: 'tour-1',
        },
        { gygId: 'partner-1' },
        { tripKitId: 'kit-1' }
      )
    ).toContain('partner_ref=SHORT1%3Akit-1')

    expect(
      buildAffiliateDestination(
        {
          provider: 'VIATOR',
          affiliateUrl: 'https://viator.example/fallback',
          targetUrl: 'https://viator.example/product',
          providerProductId: null,
        },
        { viatorMcid: 'mcid-1' }
      )
    ).toBe('https://viator.example/product?mcid=mcid-1')

    expect(
      buildAffiliateDestination(
        {
          provider: 'CUSTOM',
          affiliateUrl: '',
          targetUrl: 'https://example.com/product',
          providerProductId: null,
        },
        {}
      )
    ).toBe('https://example.com/product')
  })

  it('builds and parses partner refs and resolves kit attribution', () => {
    expect(buildAffiliatePartnerRef('SHORT1', 'kit-1')).toBe('SHORT1:kit-1')
    expect(parseAffiliatePartnerRef('SHORT1:kit-1')).toEqual({
      shortCode: 'SHORT1',
      tripKitId: 'kit-1',
    })

    expect(
      resolveAttributedTripKitId({
        explicitTripKitId: 'kit-1',
        linkedTripKitIds: ['kit-1', 'kit-2'],
      })
    ).toEqual({
      tripKitId: 'kit-1',
      attributionMethod: 'EXACT_PARTNER_REF',
    })

    expect(
      resolveAttributedTripKitId({
        linkedTripKitIds: ['kit-2'],
      })
    ).toEqual({
      tripKitId: 'kit-2',
      attributionMethod: 'UNIQUE_LINK',
    })

    expect(
      resolveAttributedTripKitId({
        linkedTripKitIds: ['kit-1', 'kit-2'],
      })
    ).toEqual({
      tripKitId: null,
      attributionMethod: null,
    })
  })
})
