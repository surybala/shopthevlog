import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, POST } from '../app/api/test-support/login/route'

describe('test-support login route', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 when E2E auth is disabled', async () => {
    vi.stubEnv('ENABLE_E2E_AUTH', 'false')

    const response = await POST(
      new Request('http://localhost/api/test-support/login', {
        method: 'POST',
        body: JSON.stringify({ userId: 'creator-1' }),
      })
    )

    expect(response.status).toBe(404)
  })

  it('sets the E2E auth cookie when given a user id', async () => {
    vi.stubEnv('ENABLE_E2E_AUTH', 'true')

    const response = await POST(
      new Request('http://localhost/api/test-support/login', {
        method: 'POST',
        body: JSON.stringify({ userId: 'creator-1' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('vs_e2e_user_id=creator-1')
  })

  it('clears the E2E auth cookie on delete', async () => {
    vi.stubEnv('ENABLE_E2E_AUTH', 'true')

    const response = await DELETE()

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
