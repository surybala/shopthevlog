import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

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

  // Record click event (fire-and-forget)
  void Promise.all([
    prisma.clickEvent.create({
      data: {
        linkId: link.id,
        creatorId: link.creatorId,
        subscriberId,
        sessionId: req.cookies.get('vs_session')?.value ?? crypto.randomUUID(),
        tripKitId: req.nextUrl.searchParams.get('kit') ?? null,
        referrer: req.headers.get('referer') ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    }).catch(() => {}),
    prisma.affiliateLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    }).catch(() => {}),
    prisma.tripKit.updateMany(
      link.id
        ? { where: { affiliateLinks: { some: { id: link.id } } }, data: { clickCount: { increment: 1 } } }
        : { where: { id: 'never' }, data: {} }
    ).catch(() => {}),
  ])

  // Build provider-specific destination URL
  const dest = buildAffiliateUrl(link)
  return NextResponse.redirect(dest, { status: 302 })
}

function buildAffiliateUrl(link: {
  provider: string
  affiliateUrl: string
  targetUrl: string
  providerProductId: string | null
}): string {
  const stayAid = process.env.STAY22_AFFILIATE_ID
  const gygId = process.env.GYG_PARTNER_ID
  const viatorMcid = process.env.VIATOR_MCID
  const amazonTag = process.env.AMAZON_ASSOCIATE_TAG
  const skyscannerId = process.env.SKYSCANNER_AFFILIATE_ID
  const bookingAid = process.env.BOOKING_COM_AFFILIATE_ID

  switch (link.provider) {
    case 'STAY22':
      return stayAid && link.providerProductId
        ? `https://www.stay22.com/book/${link.providerProductId}?aid=${stayAid}`
        : link.affiliateUrl
    case 'GETYOURGUIDE':
      return gygId && link.providerProductId
        ? `https://www.getyourguide.com/activity/${link.providerProductId}/?partner_id=${gygId}&utm_source=vlogshopper`
        : link.affiliateUrl
    case 'VIATOR':
      return viatorMcid ? `${link.targetUrl}?mcid=${viatorMcid}` : link.affiliateUrl
    case 'AMAZON':
      return amazonTag ? `${link.targetUrl}?tag=${amazonTag}` : link.affiliateUrl
    case 'SKYSCANNER':
      return skyscannerId ? `${link.targetUrl}&associateId=${skyscannerId}` : link.affiliateUrl
    case 'BOOKING_COM':
      return bookingAid && link.providerProductId
        ? `https://www.booking.com/hotel/${link.providerProductId}.html?aid=${bookingAid}`
        : link.affiliateUrl
    default:
      return link.affiliateUrl || link.targetUrl
  }
}
