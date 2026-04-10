import { afterEach, describe, expect, it } from 'vitest'
import { hasAdminMetadata, isAdmin, isAdminUser } from '../lib/admin'

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS
const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL

afterEach(() => {
  process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
  process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL
})

describe('admin helpers', () => {
  it('matches configured admin emails', () => {
    process.env.ADMIN_EMAILS = 'admin@vlogshopper.com, ops@vlogshopper.com'

    expect(isAdmin('admin@vlogshopper.com')).toBe(true)
    expect(isAdmin('member@vlogshopper.com')).toBe(false)
  })

  it('detects persisted admin metadata', () => {
    expect(hasAdminMetadata({ app_metadata: { is_admin: true } })).toBe(true)
    expect(hasAdminMetadata({ app_metadata: { admin: true } })).toBe(true)
    expect(hasAdminMetadata({ app_metadata: { role: 'admin' } })).toBe(true)
    expect(hasAdminMetadata({ app_metadata: { role: 'member' } })).toBe(false)
  })

  it('allows admins via metadata even when env email does not match', () => {
    process.env.ADMIN_EMAILS = 'founder@vlogshopper.com'

    expect(
      isAdminUser({
        email: 'ops@example.com',
        app_metadata: { is_admin: true },
      })
    ).toBe(true)
  })
})
