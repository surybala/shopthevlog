import { describe, expect, it, vi } from 'vitest'
import {
  E2E_AUTH_COOKIE,
  buildE2EUser,
  getE2EUserIdFromCookies,
} from '@/lib/e2eAuth'

describe('e2e auth helpers', () => {
  it('returns the E2E user id when test auth is enabled', async () => {
    vi.stubEnv('ENABLE_E2E_AUTH', 'true')

    expect(
      getE2EUserIdFromCookies({
        get(name: string) {
          return name === E2E_AUTH_COOKIE ? { value: 'creator-user-1' } : undefined
        },
      })
    ).toBe('creator-user-1')

    vi.unstubAllEnvs()
  })

  it('returns null when E2E auth is disabled', async () => {
    vi.stubEnv('ENABLE_E2E_AUTH', 'false')

    expect(
      getE2EUserIdFromCookies({
        get() {
          return { value: 'creator-user-1' }
        },
      })
    ).toBeNull()

    vi.unstubAllEnvs()
  })

  it('builds an approved test user payload', () => {
    expect(buildE2EUser('creator-user-1')).toMatchObject({
      id: 'creator-user-1',
      app_metadata: {
        approved: true,
        provider: 'e2e',
      },
    })
  })

  it('marks admin-flavored e2e users as admins', () => {
    vi.stubEnv('E2E_ADMIN_USER_IDS', 'e2e-admin-ops')

    expect(buildE2EUser('e2e-admin-ops')).toMatchObject({
      app_metadata: {
        admin: true,
        is_admin: true,
        role: 'admin',
      },
      user_metadata: {
        full_name: 'E2E Admin',
      },
    })

    vi.unstubAllEnvs()
  })
})
