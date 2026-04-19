import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import { sendApprovalEmail } from '@/lib/email'

/**
 * POST /api/admin/waitlist/[id]/approve
 *
 * Approves a waitlist request:
 * 1. Marks the DB record as APPROVED
 * 2. Sends the approval email with signup link
 * 3. If the person already has a Supabase account, sets app_metadata.approved = true
 *    immediately so they don't need to log out and back in.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await requireAdmin()
  if (result instanceof NextResponse) return result

  const request = await prisma.waitlistRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.status === 'APPROVED') {
    return NextResponse.json({ ok: true, message: 'Already approved' })
  }

  // 1. Mark as approved in DB
  await prisma.waitlistRequest.update({
    where: { id: params.id },
    data: { status: 'APPROVED', approvedAt: new Date() },
  })

  // 2. Send approval email (fire-and-forget, log on failure).
  // Wrap in Promise.resolve().then() so synchronous throws (missing env vars)
  // are also caught rather than propagating.
  Promise.resolve()
    .then(() => sendApprovalEmail(request.email, request.name))
    .catch(err => console.error('sendApprovalEmail failed:', err))

  // 3. If user already exists in Supabase, stamp app_metadata.approved = true
  //    so they can access protected routes without re-authenticating.
  try {
    const admin = createSupabaseAdmin()
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existingUser = users.find(u => u.email?.toLowerCase() === request.email.toLowerCase())
    if (existingUser) {
      await admin.auth.admin.updateUserById(existingUser.id, {
        app_metadata: { ...existingUser.app_metadata, approved: true },
      })
    }
  } catch (err) {
    // Non-fatal — they'll get the flag set on next login via /auth/callback
    console.warn('Could not stamp app_metadata for existing user:', err)
  }

  return NextResponse.json({ ok: true })
}
