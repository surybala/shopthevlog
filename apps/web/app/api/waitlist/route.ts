import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { sendWaitlistConfirmation, sendAdminWaitlistNotification } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { name, email, reason } = await req.json()

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })
    }

    const emailLower = email.trim().toLowerCase()

    // Upsert — if they already requested, just update their reason
    const request = await prisma.waitlistRequest.upsert({
      where: { email: emailLower },
      update: { name: name.trim(), reason: reason?.trim() || null },
      create: { email: emailLower, name: name.trim(), reason: reason?.trim() || null },
    })

    // Fire emails in parallel; don't fail the request if email bounces
    await Promise.allSettled([
      sendWaitlistConfirmation(emailLower, name.trim()),
      sendAdminWaitlistNotification(name.trim(), emailLower, reason?.trim() || null, request.id),
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Waitlist request error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
