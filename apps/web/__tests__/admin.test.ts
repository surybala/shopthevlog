/**
 * Tests for lib/admin.ts — isAdmin()
 *
 * Pure utility — no network, DB, or framework dependencies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let originalAdminEmails: string | undefined
let originalAdminEmail: string | undefined

beforeEach(() => {
  originalAdminEmails = process.env.ADMIN_EMAILS
  originalAdminEmail  = process.env.ADMIN_EMAIL
})

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = originalAdminEmails

  if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL
  else process.env.ADMIN_EMAIL = originalAdminEmail

  vi.resetModules()
})

async function isAdmin(email: string): Promise<boolean> {
  const { isAdmin } = await import('../lib/admin')
  return isAdmin(email)
}

// ── No config ─────────────────────────────────────────────────────────────────

describe('when neither ADMIN_EMAILS nor ADMIN_EMAIL is set', () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
    delete process.env.ADMIN_EMAIL
  })

  it('denies everyone — no admins configured means no access', async () => {
    expect(await isAdmin('anyone@example.com')).toBe(false)
  })
})

// ── ADMIN_EMAILS (primary) ────────────────────────────────────────────────────

describe('ADMIN_EMAILS env var', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'cherry@vlogshopper.com,surya@vlogshopper.com'
    delete process.env.ADMIN_EMAIL
  })

  it('grants access to first listed admin', async () => {
    expect(await isAdmin('cherry@vlogshopper.com')).toBe(true)
  })

  it('grants access to second listed admin', async () => {
    expect(await isAdmin('surya@vlogshopper.com')).toBe(true)
  })

  it('denies non-listed email', async () => {
    expect(await isAdmin('hacker@evil.com')).toBe(false)
  })

  it('is case-insensitive', async () => {
    expect(await isAdmin('CHERRY@VLOGSHOPPER.COM')).toBe(true)
  })

  it('trims whitespace around entries', async () => {
    process.env.ADMIN_EMAILS = '  cherry@vlogshopper.com  ,  surya@vlogshopper.com  '
    expect(await isAdmin('cherry@vlogshopper.com')).toBe(true)
  })

  it('denies empty string', async () => {
    expect(await isAdmin('')).toBe(false)
  })
})

// ── ADMIN_EMAIL fallback ──────────────────────────────────────────────────────

describe('ADMIN_EMAIL fallback when ADMIN_EMAILS is not set', () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
    process.env.ADMIN_EMAIL = 'cherry@vlogshopper.com'
  })

  it('grants access to the single admin', async () => {
    expect(await isAdmin('cherry@vlogshopper.com')).toBe(true)
  })

  it('denies any other email', async () => {
    expect(await isAdmin('other@vlogshopper.com')).toBe(false)
  })
})

// ── ADMIN_EMAILS takes precedence ─────────────────────────────────────────────

describe('ADMIN_EMAILS takes precedence over ADMIN_EMAIL', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'alice@vlogshopper.com'
    process.env.ADMIN_EMAIL  = 'cherry@vlogshopper.com'
  })

  it('uses ADMIN_EMAILS — allows alice', async () => {
    expect(await isAdmin('alice@vlogshopper.com')).toBe(true)
  })

  it('uses ADMIN_EMAILS — denies cherry (only in ADMIN_EMAIL)', async () => {
    expect(await isAdmin('cherry@vlogshopper.com')).toBe(false)
  })
})

// ── Single entry ──────────────────────────────────────────────────────────────

describe('single-entry ADMIN_EMAILS', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'cherry@vlogshopper.com'
  })

  it('allows the single admin', async () => {
    expect(await isAdmin('cherry@vlogshopper.com')).toBe(true)
  })

  it('denies everyone else', async () => {
    expect(await isAdmin('notcherry@vlogshopper.com')).toBe(false)
  })
})
