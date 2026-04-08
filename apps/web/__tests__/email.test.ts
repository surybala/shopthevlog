/**
 * Tests for lib/email.ts — Zoho SMTP email helpers.
 *
 * Mocks nodemailer so no real SMTP connection is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock nodemailer ────────────────────────────────────────────────────────────
const mockSendMail = vi.fn()
const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }))

vi.mock('nodemailer', () => ({
  default: { createTransport: (...a: unknown[]) => mockCreateTransport(...a) },
}))

// Set required env vars before importing the module
process.env.ZOHO_SMTP_USER = 'cherry@vlogshopper.com'
process.env.ZOHO_SMTP_PASS = 'test-app-password'
process.env.ADMIN_EMAIL    = 'cherry@vlogshopper.com'
process.env.NEXT_PUBLIC_BASE_URL = 'https://vlogshopper.com'

import {
  sendWaitlistConfirmation,
  sendAdminWaitlistNotification,
  sendApprovalEmail,
} from '../lib/email'

beforeEach(() => {
  vi.clearAllMocks()
  mockSendMail.mockResolvedValue({ messageId: 'test-id' })
})

// ── Transport creation ────────────────────────────────────────────────────────

describe('SMTP transport', () => {
  it('creates transport with Zoho SMTP settings', async () => {
    await sendWaitlistConfirmation('user@example.com', 'Alice')
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.zoho.com',
        port: 465,
        secure: true,
        auth: expect.objectContaining({
          user: 'cherry@vlogshopper.com',
          pass: 'test-app-password',
        }),
      })
    )
  })

  it('throws if ZOHO_SMTP_USER is missing', async () => {
    const orig = process.env.ZOHO_SMTP_USER
    delete process.env.ZOHO_SMTP_USER
    vi.resetModules()
    const { sendWaitlistConfirmation: fn } = await import('../lib/email')
    await expect(fn('user@example.com', 'Alice')).rejects.toThrow('ZOHO_SMTP_USER')
    process.env.ZOHO_SMTP_USER = orig
  })

  it('throws if ZOHO_SMTP_PASS is missing', async () => {
    const orig = process.env.ZOHO_SMTP_PASS
    delete process.env.ZOHO_SMTP_PASS
    vi.resetModules()
    const { sendWaitlistConfirmation: fn } = await import('../lib/email')
    await expect(fn('user@example.com', 'Alice')).rejects.toThrow('ZOHO_SMTP_PASS')
    process.env.ZOHO_SMTP_PASS = orig
  })
})

// ── sendWaitlistConfirmation ──────────────────────────────────────────────────

describe('sendWaitlistConfirmation', () => {
  it('sends to the requester email', async () => {
    await sendWaitlistConfirmation('alice@example.com', 'Alice')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@example.com' })
    )
  })

  it('sends from cherry@vlogshopper.com', async () => {
    await sendWaitlistConfirmation('alice@example.com', 'Alice')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining('cherry@vlogshopper.com') })
    )
  })

  it('subject contains waitlist keyword', async () => {
    await sendWaitlistConfirmation('alice@example.com', 'Alice')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.subject.toLowerCase()).toMatch(/waitlist/)
  })

  it('HTML body contains the recipient name', async () => {
    await sendWaitlistConfirmation('alice@example.com', 'Alice')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('Alice')
  })

  it('HTML body contains a discover link', async () => {
    await sendWaitlistConfirmation('alice@example.com', 'Alice')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('https://vlogshopper.com/discover')
  })

  it('returns the sendMail result', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'abc-123' })
    const result = await sendWaitlistConfirmation('alice@example.com', 'Alice')
    expect(result).toEqual({ messageId: 'abc-123' })
  })
})

// ── sendAdminWaitlistNotification ─────────────────────────────────────────────

describe('sendAdminWaitlistNotification', () => {
  it('sends to the admin email', async () => {
    await sendAdminWaitlistNotification('Bob', 'bob@example.com', null, 'req-1')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'cherry@vlogshopper.com' })
    )
  })

  it('subject contains the requester name', async () => {
    await sendAdminWaitlistNotification('Bob Smith', 'bob@example.com', null, 'req-1')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.subject).toContain('Bob Smith')
  })

  it('HTML body contains requester email', async () => {
    await sendAdminWaitlistNotification('Bob', 'bob@example.com', null, 'req-1')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('bob@example.com')
  })

  it('HTML body contains reason when provided', async () => {
    await sendAdminWaitlistNotification('Bob', 'bob@example.com', 'I love travel vlogs', 'req-1')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('I love travel vlogs')
  })

  it('HTML body omits reason row when reason is null', async () => {
    await sendAdminWaitlistNotification('Bob', 'bob@example.com', null, 'req-1')
    const call = mockSendMail.mock.calls[0][0]
    // The "Reason" table row should not appear
    expect(call.html).not.toContain('>Reason<')
  })

  it('HTML body contains link to dashboard waitlist', async () => {
    await sendAdminWaitlistNotification('Bob', 'bob@example.com', null, 'req-1')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('/dashboard/waitlist')
  })
})

// ── sendApprovalEmail ─────────────────────────────────────────────────────────

describe('sendApprovalEmail', () => {
  it('sends to the approved user email', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'carol@example.com' })
    )
  })

  it('subject indicates approval', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.subject.toLowerCase()).toMatch(/approved|in/)
  })

  it('HTML body contains the recipient name', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('Carol')
  })

  it('HTML body contains the signup URL', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('https://vlogshopper.com/signup')
  })

  it('HTML body contains the approved email address', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain('carol@example.com')
  })

  it('HTML body warns to use the same email', async () => {
    await sendApprovalEmail('carol@example.com', 'Carol')
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html.toLowerCase()).toMatch(/sign up with/)
  })
})
