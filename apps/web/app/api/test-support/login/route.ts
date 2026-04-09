import { NextResponse } from 'next/server'
import {
  E2E_AUTH_COOKIE,
  getE2EAuthCookieOptions,
  isE2EAuthEnabled,
} from '@/lib/e2eAuth'

export async function POST(req: Request) {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true, userId })
  response.cookies.set(E2E_AUTH_COOKIE, userId, getE2EAuthCookieOptions())
  return response
}

export async function DELETE() {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(E2E_AUTH_COOKIE, '', {
    ...getE2EAuthCookieOptions(),
    maxAge: 0,
  })
  return response
}
