/**
 * Tests for:
 *   GET  /api/admin/waitlist
 *   POST /api/admin/waitlist/[id]/approve
 *
 * Mocks Supabase, Prisma, admin Supabase client, and email helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock Supabase (server) ─────────────────────────────────────────────────────
const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

// ── Mock Supabase (admin) ─────────────────────────────────────────────────────
const mockListUsers        = vi.fn()
const mockUpdateUserById   = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    auth: {
      admin: {
        listUsers:      (...a: unknown[]) => mockListUsers(...a),
        updateUserById: (...a: unknown[]) => mockUpdateUserById(...a),
      },
    },
  }),
}))

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockCreatorFindUnique        = vi.fn()
const mockWaitlistFindMany         = vi.fn()
const mockWaitlistFindUnique       = vi.fn()
const mockWaitlistUpdate           = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...a: unknown[]) => mockCreatorFindUnique(...a),
    },
    waitlistRequest: {
      findMany:   (...a: unknown[]) => mockWaitlistFindMany(...a),
      findUnique: (...a: unknown[]) => mockWaitlistFindUnique(...a),
      update:     (...a: unknown[]) => mockWaitlistUpdate(...a),
    },
  },
}))

// ── Mock email helpers ────────────────────────────────────────────────────────
const mockSendApprovalEmail = vi.fn()
vi.mock('@/lib/email', () => ({
  sendApprovalEmail:               (...a: unknown[]) => mockSendApprovalEmail(...a),
  sendWaitlistConfirmation:        vi.fn(),
  sendAdminWaitlistNotification:   vi.fn(),
}))

// ── Mock nodemailer (needed by email.ts if not fully mocked) ──────────────────
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: vi.fn().mockResolvedValue({}) }) },
}))

// Set admin env before importing routes
process.env.ADMIN_EMAILS = 'cherry@vlogshopper.com'

import { GET } from '../app/api/admin/waitlist/route'
import { POST as APPROVE } from '../app/api/admin/waitlist/[id]/approve/route'

const ADMIN_USER    = { id: 'user-admin', email: 'cherry@vlogshopper.com' }
const NON_ADMIN     = { id: 'user-other', email: 'hacker@evil.com' }
const CREATOR       = { id: 'creator-1' }
const PENDING_REQ   = { id: 'req-1', email: 'alice@example.com', name: 'Alice', status: 'PENDING' }
const APPROVED_REQ  = { id: 'req-2', email: 'bob@example.com',   name: 'Bob',   status: 'APPROVED' }

function makeRequest(method: string, url: string): NextRequest {
  return new NextRequest(url, { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: ADMIN_USER } })
  mockCreatorFindUnique.mockResolvedValue(CREATOR)
  mockWaitlistFindMany.mockResolvedValue([PENDING_REQ])
  mockWaitlistFindUnique.mockResolvedValue(PENDING_REQ)
  mockWaitlistUpdate.mockResolvedValue({ ...PENDING_REQ, status: 'APPROVED' })
  mockSendApprovalEmail.mockResolvedValue({})
  mockListUsers.mockResolvedValue({ data: { users: [] } })
  mockUpdateUserById.mockResolvedValue({})
})

// ── GET /api/admin/waitlist ───────────────────────────────────────────────────

describe('GET /api/admin/waitlist', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not an admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: NON_ADMIN } })
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns list of pending requests by default', async () => {
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([PENDING_REQ])
  })

  it('filters by status query param', async () => {
    mockWaitlistFindMany.mockResolvedValue([APPROVED_REQ])
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist?status=APPROVED')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'APPROVED' } })
    )
  })

  it('returns all requests when status=ALL', async () => {
    mockWaitlistFindMany.mockResolvedValue([PENDING_REQ, APPROVED_REQ])
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist?status=ALL')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })

  it('returns empty array when no requests match', async () => {
    mockWaitlistFindMany.mockResolvedValue([])
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist')
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('orders results by createdAt desc', async () => {
    const req = makeRequest('GET', 'http://localhost/api/admin/waitlist')
    await GET(req)
    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    )
  })
})

// ── POST /api/admin/waitlist/[id]/approve ─────────────────────────────────────

describe('POST /api/admin/waitlist/[id]/approve', () => {
  const params = { id: 'req-1' }

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    const res = await APPROVE(req, { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not an admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: NON_ADMIN } })
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    const res = await APPROVE(req, { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when request does not exist', async () => {
    mockWaitlistFindUnique.mockResolvedValue(null)
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/ghost/approve')
    const res = await APPROVE(req, { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  it('returns 200 with already-approved message if already approved', async () => {
    mockWaitlistFindUnique.mockResolvedValue(APPROVED_REQ)
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-2/approve')
    const res = await APPROVE(req, { params: { id: 'req-2' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/already/i)
    // Should not re-send approval email
    expect(mockSendApprovalEmail).not.toHaveBeenCalled()
  })

  it('marks request as APPROVED with timestamp', async () => {
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    await APPROVE(req, { params })
    expect(mockWaitlistUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'APPROVED', approvedAt: expect.any(Date) }),
      })
    )
  })

  it('sends approval email to the requester', async () => {
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    await APPROVE(req, { params })
    expect(mockSendApprovalEmail).toHaveBeenCalledWith('alice@example.com', 'Alice')
  })

  it('returns 200 { ok: true } on success', async () => {
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    const res = await APPROVE(req, { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('stamps app_metadata.approved when user already exists in Supabase', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'supabase-user-1', email: 'alice@example.com', app_metadata: {} },
        ],
      },
    })
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    await APPROVE(req, { params })
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'supabase-user-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({ approved: true }),
      })
    )
  })

  it('still returns ok if Supabase user stamp fails', async () => {
    mockListUsers.mockRejectedValue(new Error('Supabase API error'))
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    const res = await APPROVE(req, { params })
    // Non-fatal — approval still succeeds
    expect(res.status).toBe(200)
  })

  it('skips Supabase stamp when user does not have an account yet', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [] } })
    const req = makeRequest('POST', 'http://localhost/api/admin/waitlist/req-1/approve')
    await APPROVE(req, { params })
    expect(mockUpdateUserById).not.toHaveBeenCalled()
  })
})
