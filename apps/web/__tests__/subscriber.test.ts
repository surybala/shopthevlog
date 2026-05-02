/**
 * Tests for lib/subscriber.ts — getOrCreateSubscriber
 *
 * Mocks Prisma so no DB connection is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockFindUnique = vi.fn()
const mockCreate = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    subscriber: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}))

import { getOrCreateSubscriber } from '../lib/subscriber'

beforeEach(() => {
  vi.clearAllMocks()
})

const BASE_USER = {
  id: 'user-123',
  email: 'alex@example.com',
  user_metadata: {},
}

describe('getOrCreateSubscriber', () => {
  it('returns existing subscriber if found', async () => {
    const existing = { id: 'sub-1', displayName: 'Alex' }
    mockFindUnique.mockResolvedValue(existing)

    const result = await getOrCreateSubscriber(BASE_USER)

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId: BASE_USER.id },
      select: { id: true, displayName: true },
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toEqual(existing)
  })

  it('creates subscriber when none exists', async () => {
    mockFindUnique.mockResolvedValue(null)
    const created = { id: 'sub-new', displayName: 'alex' }
    mockCreate.mockResolvedValue(created)

    const result = await getOrCreateSubscriber(BASE_USER)

    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: BASE_USER.id, displayName: 'alex' },
      select: { id: true, displayName: true },
    })
    expect(result).toEqual(created)
  })

  it('uses full_name from user_metadata when available', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'sub-2', displayName: 'Alex Wanders' })

    await getOrCreateSubscriber({
      ...BASE_USER,
      user_metadata: { full_name: 'Alex Wanders' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'Alex Wanders' }) }),
    )
  })

  it('uses name from user_metadata when full_name absent', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'sub-3', displayName: 'Alex' })

    await getOrCreateSubscriber({
      ...BASE_USER,
      user_metadata: { name: 'Alex' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'Alex' }) }),
    )
  })

  it('falls back to email prefix when no metadata name', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'sub-4', displayName: 'alex' })

    await getOrCreateSubscriber({ id: 'u-1', email: 'alex@example.com', user_metadata: {} })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'alex' }) }),
    )
  })

  it('falls back to "Traveler" when no email and no metadata', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'sub-5', displayName: 'Traveler' })

    await getOrCreateSubscriber({ id: 'u-1' })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'Traveler' }) }),
    )
  })
})
