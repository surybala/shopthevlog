/**
 * Tests for POST /api/waitlist and GET /api/auth/whitelist-check
 *
 * Mocks Prisma and nodemailer — no network or DB calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock nodemailer ────────────────────────────────────────────────────────────
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'ok' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockUpsert = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    waitlistRequest: {
      upsert: (...a: unknown[]) => mockUpsert(...a),
    },
  },
}))

// Set env vars before importing routes
process.env.ZOHO_SMTP_USER       = 'cherry@vlogshopper.com'
process.env.ZOHO_SMTP_PASS       = 'test-pass'
process.env.ADMIN_EMAIL          = 'cherry@vlogshopper.com'
process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000'

import { POST } from '../app/api/waitlist/route'
import { GET  } from '../app/api/auth/whitelist-check/route'

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsert.mockResolvedValue({ id: 'req-1', email: 'alice@example.com', name: 'Alice' })
  mockSendMail.mockResolvedValue({ messageId: 'ok' })
})

// ── POST /api/waitlist ────────────────────────────────────────────────────────

describe('POST /api/waitlist', () => {
  it('returns 400 when name is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', { email: 'a@b.com' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name|email/i)
  })

  it('returns 400 when email is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', { name: 'Alice' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when both fields are missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is whitespace only', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', { name: '   ', email: 'a@b.com' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is whitespace only', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', { name: 'Alice', email: '   ' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 and { ok: true } on valid request', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('upserts with lowercased email', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'Alice@Example.COM',
    })
    await POST(req)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'alice@example.com' },
        create: expect.objectContaining({ email: 'alice@example.com', name: 'Alice' }),
      })
    )
  })

  it('passes optional reason to upsert', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
      reason: 'I love travel vlogs',
    })
    await POST(req)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reason: 'I love travel vlogs' }),
      })
    )
  })

  it('stores null reason when reason is omitted', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
    })
    await POST(req)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reason: null }),
      })
    )
  })

  it('fires confirmation and admin notification emails', async () => {
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
    })
    await POST(req)
    // sendMail called twice: once for confirmation, once for admin notification
    expect(mockSendMail).toHaveBeenCalledTimes(2)
  })

  it('returns 200 even when email sending fails', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP down'))
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
    })
    const res = await POST(req)
    // allSettled means email failure doesn't fail the request
    expect(res.status).toBe(200)
  })

  it('returns 500 when DB upsert throws', async () => {
    mockUpsert.mockRejectedValue(new Error('DB error'))
    const req = makeRequest('POST', 'http://localhost/api/waitlist', {
      name: 'Alice',
      email: 'alice@example.com',
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})

// ── GET /api/auth/whitelist-check ─────────────────────────────────────────────

describe('GET /api/auth/whitelist-check', () => {
  let origAllowed: string | undefined

  beforeEach(() => {
    origAllowed = process.env.ALLOWED_EMAILS
  })

  afterEach(() => {
    if (origAllowed === undefined) delete process.env.ALLOWED_EMAILS
    else process.env.ALLOWED_EMAILS = origAllowed
    vi.resetModules()
  })

  it('returns { allowed: true } when ALLOWED_EMAILS is not set', async () => {
    delete process.env.ALLOWED_EMAILS
    const req = makeRequest('GET', 'http://localhost/api/auth/whitelist-check?email=anyone@example.com')
    const res = await GET(req)
    const body = await res.json()
    expect(body.allowed).toBe(true)
  })

  it('returns { allowed: true } for a whitelisted email', async () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com'
    const req = makeRequest('GET', 'http://localhost/api/auth/whitelist-check?email=alice@example.com')
    const res = await GET(req)
    const body = await res.json()
    expect(body.allowed).toBe(true)
  })

  it('returns { allowed: false } for a non-whitelisted email', async () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com'
    const req = makeRequest('GET', 'http://localhost/api/auth/whitelist-check?email=bob@example.com')
    const res = await GET(req)
    const body = await res.json()
    expect(body.allowed).toBe(false)
  })

  it('returns { allowed: false } when email param is missing', async () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com'
    const req = makeRequest('GET', 'http://localhost/api/auth/whitelist-check')
    const res = await GET(req)
    const body = await res.json()
    // empty string is not in the whitelist
    expect(body.allowed).toBe(false)
  })
})
