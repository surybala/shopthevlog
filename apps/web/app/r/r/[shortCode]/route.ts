import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import {
  buildAffiliateDestination,
  detectAffiliateDeviceType,
  getOrCreateAffiliateSessionId,
} from '@/lib/affiliateTracking'

export async function GET(req: NextRequest, { params }: { params: { shortCode: string } }) {
  const link = await prisma.affiliateLink.findUnique({
    where: { shortCode: params.shortCode },
  })

  if (!link || !link.isActive) {
    return NextResponse.redirect(new URL('/404', req.url))
  }

  // Identify the subscriber (non-blocking — if auth fails we still redirect)
  let subscriberId: string | null = null
  try {
    const supabase = createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const sub = await prisma.subscriber.findUnique({ where: { userId: user.id }, select: { id: true } })
      subscriberId = sub?.id ?? null
    }
  } catch { /* anonymous click is fine */ }

  const sessionId = getOrCreateAffiliateSessionId(req.cookies.get('vs_session')?.value)
  const tripKitId = req.nextUrl.searchParams.get('kit') ?? null

  // Record click event (fire-and-forget)
  void Promise.all([
    prisma.clickEvent.create({
      data: {
        linkId: link.id,
        creatorId: link.creatorId,
        subscriberId,
        sessionId,
        tripKitId,
        referrer: req.headers.get('referer') ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
        device: detectAffiliateDeviceType(req.headers.get('user-agent')),
      },
    }).catch(() => {}),
    prisma.affiliateLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    }).catch(() => {}),
    tripKitId
      ? prisma.tripKit.updateMany({
          where: { id: tripKitId, affiliateLinks: { some: { id: link.id } } },
          data: { clickCount: { increment: 1 } },
        }).catch(() => {})
      : prisma.tripKit.updateMany({
          where: { affiliateLinks: { some: { id: link.id } } },
          data: { clickCount: { increment: 1 } },
        }).catch(() => {}),
  ])

  const dest = buildAffiliateDestination(link, {
    stayAid: process.env.STAY22_AFFILIATE_ID,
    gygId: process.env.GYG_PARTNER_ID,
    viatorMcid: process.env.VIATOR_MCID,
    amazonTag: process.env.AMAZON_ASSOCIATE_TAG,
    skyscannerId: process.env.SKYSCANNER_AFFILIATE_ID,
    bookingAid: process.env.BOOKING_COM_AFFILIATE_ID,
  }, { tripKitId })
  const response = NextResponse.redirect(dest, { status: 302 })
  if (!req.cookies.get('vs_session')?.value) {
    response.cookies.set('vs_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }
  return response
}
