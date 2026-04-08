import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import prisma from '@/lib/prisma/client'
import { isWhitelisted } from '@/lib/whitelist'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = createSupabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Check if already approved via app_metadata (fastest — no DB query)
        const alreadyApproved = user.app_metadata?.approved === true
        const envAllowed = user.email ? isWhitelisted(user.email) : false

        if (!alreadyApproved && !envAllowed) {
          // Check DB whitelist — the user may have been approved since they last logged in
          const approved = user.email
            ? await prisma.waitlistRequest.findFirst({
                where: { email: user.email.toLowerCase(), status: 'APPROVED' },
              })
            : null

          if (!approved) {
            return NextResponse.redirect(`${origin}/waitlist`)
          }

          // Stamp app_metadata.approved = true so future middleware checks are
          // instant (JWT claim, no DB query needed after this point)
          try {
            const admin = createSupabaseAdmin()
            await admin.auth.admin.updateUserById(user.id, {
              app_metadata: { ...user.app_metadata, approved: true },
            })
          } catch (err) {
            console.warn('Failed to stamp app_metadata.approved:', err)
          }
        }

        const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
        const redirectTo = creator ? next : '/onboarding'
        return NextResponse.redirect(`${origin}${redirectTo}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
