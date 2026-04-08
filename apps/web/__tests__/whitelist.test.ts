/**
 * Tests for lib/whitelist.ts — isWhitelisted()
 *
 * Pure utility — no network, DB, or framework dependencies.
 * Each test group sets process.env.ALLOWED_EMAILS and restores it afterwards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Store the original value so we can restore it
let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env.ALLOWED_EMAILS
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.ALLOWED_EMAILS
  } else {
    process.env.ALLOWED_EMAILS = originalEnv
  }
  // Clear the module cache so the next import picks up the new env var
  vi.resetModules()
})

import { vi } from 'vitest'

async function isWhitelisted(email: string): Promise<boolean> {
  const { isWhitelisted } = await import('../lib/whitelist')
  return isWhitelisted(email)
}

// ── Open (env not set) ────────────────────────────────────────────────────────

describe('when ALLOWED_EMAILS is not set', () => {
  beforeEach(() => { delete process.env.ALLOWED_EMAILS })

  it('allows any email', async () => {
    expect(await isWhitelisted('anyone@example.com')).toBe(true)
  })

  it('allows empty string', async () => {
    expect(await isWhitelisted('')).toBe(true)
  })
})

describe('when ALLOWED_EMAILS is empty string', () => {
  beforeEach(() => { process.env.ALLOWED_EMAILS = '' })

  it('allows any email (treated as unconfigured)', async () => {
    expect(await isWhitelisted('anyone@example.com')).toBe(true)
  })
})

// ── Exact email matching ──────────────────────────────────────────────────────

describe('exact email matching', () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = 'alice@example.com,bob@example.com'
  })

  it('allows an exact match', async () => {
    expect(await isWhitelisted('alice@example.com')).toBe(true)
  })

  it('allows second entry in the list', async () => {
    expect(await isWhitelisted('bob@example.com')).toBe(true)
  })

  it('rejects an email not in the list', async () => {
    expect(await isWhitelisted('charlie@example.com')).toBe(false)
  })

  it('is case-insensitive', async () => {
    expect(await isWhitelisted('Alice@Example.COM')).toBe(true)
  })

  it('trims whitespace around email', async () => {
    process.env.ALLOWED_EMAILS = '  alice@example.com  ,  bob@example.com  '
    expect(await isWhitelisted('alice@example.com')).toBe(true)
  })

  it('rejects completely different domain', async () => {
    expect(await isWhitelisted('alice@other.com')).toBe(false)
  })
})

// ── Domain wildcard matching ──────────────────────────────────────────────────

describe('domain wildcard (*@domain.com)', () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = '*@acme.com,specific@other.com'
  })

  it('allows any email at the wildcard domain', async () => {
    expect(await isWhitelisted('anyone@acme.com')).toBe(true)
  })

  it('allows a different user at the wildcard domain', async () => {
    expect(await isWhitelisted('cherry@acme.com')).toBe(true)
  })

  it('rejects email at a different domain', async () => {
    expect(await isWhitelisted('anyone@notacme.com')).toBe(false)
  })

  it('rejects subdomain of wildcard domain', async () => {
    expect(await isWhitelisted('user@sub.acme.com')).toBe(false)
  })

  it('still allows exact match alongside wildcard', async () => {
    expect(await isWhitelisted('specific@other.com')).toBe(true)
  })

  it('rejects non-listed domain even if similar', async () => {
    expect(await isWhitelisted('user@acme.org')).toBe(false)
  })
})

// ── Mixed list ────────────────────────────────────────────────────────────────

describe('mixed exact + wildcard list', () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = 'admin@vlogshopper.com,*@partner.com,beta@gmail.com'
  })

  it('allows exact admin match', async () => {
    expect(await isWhitelisted('admin@vlogshopper.com')).toBe(true)
  })

  it('allows any partner domain email', async () => {
    expect(await isWhitelisted('anyone@partner.com')).toBe(true)
  })

  it('allows exact beta user', async () => {
    expect(await isWhitelisted('beta@gmail.com')).toBe(true)
  })

  it('rejects unlisted gmail address', async () => {
    expect(await isWhitelisted('other@gmail.com')).toBe(false)
  })

  it('rejects completely unlisted address', async () => {
    expect(await isWhitelisted('hacker@evil.com')).toBe(false)
  })
})

// ── Single entry ──────────────────────────────────────────────────────────────

describe('single entry list', () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = 'cherry@vlogshopper.com'
  })

  it('allows the single listed email', async () => {
    expect(await isWhitelisted('cherry@vlogshopper.com')).toBe(true)
  })

  it('rejects any other email', async () => {
    expect(await isWhitelisted('other@vlogshopper.com')).toBe(false)
  })
})
