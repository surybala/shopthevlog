import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

const mockCreatorFindUnique = vi.fn()
const mockCreatorUpdate = vi.fn()
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
      update: (...args: unknown[]) => mockCreatorUpdate(...args),
    },
  },
}))

const mockAccountCreate = vi.fn()
const mockAccountLinksCreate = vi.fn()
const mockCreateLoginLink = vi.fn()
vi.mock('@/lib/stripe', () => ({
  stripe: {
    accounts: {
      create: (...args: unknown[]) => mockAccountCreate(...args),
      createLoginLink: (...args: unknown[]) => mockCreateLoginLink(...args),
    },
    accountLinks: {
      create: (...args: unknown[]) => mockAccountLinksCreate(...args),
    },
  },
}))

import { GET as onboardGet } from '../app/api/stripe/connect/onboard/route'
import { GET as dashboardGet } from '../app/api/stripe/connect/dashboard/route'

describe('stripe connect routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000'
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'creator@example.com' } } })
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      stripeAccountId: null,
      defaultCurrency: 'USD',
      payoutsEnabled: false,
    })
    mockCreatorUpdate.mockResolvedValue({})
    mockAccountCreate.mockResolvedValue({ id: 'acct_123' })
    mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/s/acct_123' })
    mockCreateLoginLink.mockResolvedValue({ url: 'https://connect.stripe.com/express/acct_123' })
  })

  it('creates a Stripe Connect account and redirects into onboarding', async () => {
    const res = await onboardGet(new NextRequest('http://localhost/api/stripe/connect/onboard'))

    expect(mockAccountCreate).toHaveBeenCalled()
    expect(mockCreatorUpdate).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { stripeAccountId: 'acct_123' },
    })
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'acct_123',
        type: 'account_onboarding',
      }),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://connect.stripe.com/setup/s/acct_123')
  })

  it('reuses an existing Stripe account for onboarding refresh', async () => {
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      stripeAccountId: 'acct_existing',
      defaultCurrency: 'USD',
      payoutsEnabled: false,
    })

    await onboardGet(new NextRequest('http://localhost/api/stripe/connect/onboard'))

    expect(mockAccountCreate).not.toHaveBeenCalled()
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'acct_existing',
      }),
    )
  })

  it('opens the Stripe Express dashboard when an account exists', async () => {
    mockCreatorFindUnique.mockResolvedValue({
      stripeAccountId: 'acct_123',
    })

    const res = await dashboardGet(new NextRequest('http://localhost/api/stripe/connect/dashboard'))

    expect(mockCreateLoginLink).toHaveBeenCalledWith('acct_123')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://connect.stripe.com/express/acct_123')
  })
})
