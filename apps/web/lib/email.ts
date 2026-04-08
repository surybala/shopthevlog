/**
 * Email helpers using Zoho Mail SMTP via nodemailer.
 *
 * Required env vars:
 *   ZOHO_SMTP_USER   — your Zoho email address, e.g. cherry@vlogshopper.com
 *   ZOHO_SMTP_PASS   — Zoho app-specific password (not your login password)
 *                      Generate at: Zoho Mail → Settings → Security → App Passwords
 *   ADMIN_EMAIL      — where admin notifications are sent (defaults to ZOHO_SMTP_USER)
 *   NEXT_PUBLIC_BASE_URL — e.g. https://vlogshopper.com
 */
import nodemailer from 'nodemailer'

function transporter() {
  const user = process.env.ZOHO_SMTP_USER
  const pass = process.env.ZOHO_SMTP_PASS
  if (!user || !pass) throw new Error('ZOHO_SMTP_USER and ZOHO_SMTP_PASS must be set')

  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true, // SSL
    auth: { user, pass },
  })
}

const FROM  = () => `VlogShopper <${process.env.ZOHO_SMTP_USER ?? 'cherry@vlogshopper.com'}>`
const ADMIN = () => process.env.ADMIN_EMAIL ?? process.env.ZOHO_SMTP_USER ?? 'cherry@vlogshopper.com'
const BASE  = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

// ── 1. Confirmation to the person who just joined the waitlist ────────────────

export async function sendWaitlistConfirmation(to: string, name: string) {
  return transporter().sendMail({
    from: FROM(),
    to,
    subject: "You're on the VlogShopper waitlist 🎬",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="margin-bottom:4px">Hey ${name} 👋</h2>
        <p style="color:#555">
          Thanks for requesting early access to <strong>VlogShopper</strong>.
          You're on our list — we'll email you as soon as your spot is ready.
        </p>
        <p style="color:#555">
          In the meantime, you can browse public creator storefronts — no account needed.
        </p>
        <a href="${BASE()}/discover"
           style="display:inline-block;margin-top:16px;padding:12px 24px;background:#fff;color:#000;border:1px solid #000;border-radius:8px;text-decoration:none;font-weight:600">
          Browse storefronts →
        </a>
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee" />
        <p style="color:#999;font-size:12px">VlogShopper · Creator-first travel commerce</p>
      </div>
    `,
  })
}

// ── 2. Notification to admin when a new request comes in ─────────────────────

export async function sendAdminWaitlistNotification(
  requesterName: string,
  requesterEmail: string,
  reason: string | null,
  requestId: string,
) {
  const approveUrl = `${BASE()}/dashboard/waitlist`
  return transporter().sendMail({
    from: FROM(),
    to: ADMIN(),
    subject: `New waitlist request from ${requesterName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2>New early-access request</h2>
        <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
          <tr><td style="padding:6px 0;color:#555;width:80px">Name</td><td><strong>${requesterName}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#555">Email</td><td>${requesterEmail}</td></tr>
          ${reason ? `<tr><td style="padding:6px 0;color:#555;vertical-align:top">Reason</td><td>${reason}</td></tr>` : ''}
        </table>
        <a href="${approveUrl}"
           style="display:inline-block;padding:12px 24px;background:#000;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Review in dashboard →
        </a>
      </div>
    `,
  })
}

// ── 3. Approval email sent to requester when admin approves ───────────────────

export async function sendApprovalEmail(to: string, name: string) {
  const signupUrl = `${BASE()}/signup`
  return transporter().sendMail({
    from: FROM(),
    to,
    subject: "You're in — VlogShopper early access ✅",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2>You're approved, ${name}! 🎉</h2>
        <p style="color:#555">
          Your early access to <strong>VlogShopper</strong> is ready.
          Create your account using this email address (<strong>${to}</strong>) and
          you'll be let straight in.
        </p>
        <a href="${signupUrl}"
           style="display:inline-block;margin-top:8px;padding:14px 28px;background:#000;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
          Create my account →
        </a>
        <p style="margin-top:24px;color:#888;font-size:13px">
          Make sure to sign up with <strong>${to}</strong> — other addresses won't be recognised.
        </p>
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee" />
        <p style="color:#999;font-size:12px">VlogShopper · Creator-first travel commerce</p>
      </div>
    `,
  })
}
