/**
 * Tests for the Axios API client (src/lib/api.ts).
 *
 * Verifies:
 *   - JWT is injected from Supabase session on every request
 *   - No Authorization header when session is absent
 *   - Error interceptor surfaces detail message from API response
 *   - Error interceptor falls back to err.message
 *   - Error interceptor falls back to generic message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase BEFORE importing api ───────────────────────────────────────
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}))

// Import after mock is in place
import { supabase } from '../supabase'
import api, { ApiError } from '../api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockGetSession = supabase.auth.getSession as ReturnType<typeof vi.fn>

function sessionWith(token: string | null) {
  mockGetSession.mockResolvedValue({
    data: {
      session: token ? { access_token: token } : null,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Request interceptor — JWT injection
// ─────────────────────────────────────────────────────────────────────────────

describe('API client — request interceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attaches Authorization header when session has access_token', async () => {
    sessionWith('test-jwt-token')

    // Run the request interceptor manually
    const requestInterceptors = (api.interceptors.request as any).handlers
    const interceptor = requestInterceptors[0]

    const config = { headers: {} as Record<string, string> }
    const result = await interceptor.fulfilled(config)

    expect(result.headers['Authorization']).toBe('Bearer test-jwt-token')
  })

  it('does not attach Authorization header when session is null', async () => {
    sessionWith(null)

    const requestInterceptors = (api.interceptors.request as any).handlers
    const interceptor = requestInterceptors[0]

    const config = { headers: {} as Record<string, string> }
    const result = await interceptor.fulfilled(config)

    expect(result.headers['Authorization']).toBeUndefined()
  })

  it('returns config unchanged when getSession resolves without token', async () => {
    mockGetSession.mockResolvedValue({ data: { session: {} } }) // session with no token

    const requestInterceptors = (api.interceptors.request as any).handlers
    const interceptor = requestInterceptors[0]

    const config = { headers: {}, baseURL: '/api/v1' } as any
    const result = await interceptor.fulfilled(config)

    expect(result.baseURL).toBe('/api/v1')
    expect(result.headers['Authorization']).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Response interceptor — error surfacing
// ─────────────────────────────────────────────────────────────────────────────

describe('API client — response interceptor', () => {
  function getErrorInterceptor() {
    const handlers = (api.interceptors.response as any).handlers
    return handlers[0]
  }

  it('passes successful responses through unchanged', async () => {
    const interceptor = getErrorInterceptor()
    const response = { status: 200, data: { ok: true } }
    const result = await interceptor.fulfilled(response)
    expect(result).toEqual(response)
  })

  it('surfaces detail field from API error response', async () => {
    const interceptor = getErrorInterceptor()
    const err = { response: { data: { detail: 'Not authenticated' } }, message: 'Request failed' }

    await expect(interceptor.rejected(err)).rejects.toThrow('Not authenticated')
  })

  it('falls back to err.message when no detail field', async () => {
    const interceptor = getErrorInterceptor()
    const err = { response: { data: {} }, message: 'Network Error' }

    await expect(interceptor.rejected(err)).rejects.toThrow('Network Error')
  })

  it('falls back to generic message when no response and no err.message', async () => {
    const interceptor = getErrorInterceptor()
    const err = {}

    await expect(interceptor.rejected(err)).rejects.toThrow('Something went wrong')
  })

  it('wraps error in ApiError instance with status code', async () => {
    const interceptor = getErrorInterceptor()
    const err = { response: { status: 403, data: { detail: 'Forbidden' } }, message: 'nope' }

    try {
      await interceptor.rejected(err)
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(403)
      expect((e as ApiError).message).toBe('Forbidden')
    }
  })

  it('preserves 409 status for stale offer detection', async () => {
    const interceptor = getErrorInterceptor()
    const err = {
      response: { status: 409, data: { detail: 'This flight offer has expired.' } },
      message: 'Request failed with status 409',
    }

    try {
      await interceptor.rejected(err)
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(409)
    }
  })

  it('status is undefined when no response (network error)', async () => {
    const interceptor = getErrorInterceptor()
    const err = { message: 'Network Error' }

    try {
      await interceptor.rejected(err)
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBeUndefined()
    }
  })

  it('prefers response.data.detail over err.message', async () => {
    const interceptor = getErrorInterceptor()
    const err = {
      response: { data: { detail: 'API says: token expired' } },
      message: 'Request failed with status 401',
    }

    await expect(interceptor.rejected(err)).rejects.toThrow('API says: token expired')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Instance configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('API client — instance config', () => {
  it('has Content-Type: application/json header', () => {
    const defaults = (api.defaults.headers as any)['Content-Type'] ||
                     (api.defaults.headers.common as any)?.['Content-Type'] ||
                     (api.defaults.headers.post as any)?.['Content-Type']
    // At least one of these should be set
    const contentType = api.defaults.headers['Content-Type'] as string
    expect(contentType).toBe('application/json')
  })
})
