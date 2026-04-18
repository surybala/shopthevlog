import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockFindUnique = vi.fn()
const mockUpload = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
      }),
    },
  }),
}))

import { POST } from '../app/api/creator/media/route'

describe('creator media route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockFindUnique.mockResolvedValue({ id: 'creator-1' })
    mockUpload.mockResolvedValue({ error: null })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const formData = new FormData()
    formData.append('kind', 'cover')
    formData.append('files', new File(['image'], 'cover.jpg', { type: 'image/jpeg' }))

    const res = await POST(
      new NextRequest('http://localhost/api/creator/media', {
        method: 'POST',
        body: formData,
      }),
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 for unsupported upload kind', async () => {
    const formData = new FormData()
    formData.append('kind', 'avatar')
    formData.append('files', new File(['image'], 'avatar.jpg', { type: 'image/jpeg' }))

    const res = await POST(
      new NextRequest('http://localhost/api/creator/media', {
        method: 'POST',
        body: formData,
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid upload type.' })
  })

  it('returns 400 for non-image uploads', async () => {
    const formData = new FormData()
    formData.append('kind', 'gallery')
    formData.append('files', new File(['text'], 'notes.txt', { type: 'text/plain' }))

    const res = await POST(
      new NextRequest('http://localhost/api/creator/media', {
        method: 'POST',
        body: formData,
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Only image uploads are supported.' })
  })

  it('uploads image files and returns storage paths', async () => {
    const formData = new FormData()
    formData.append('kind', 'cover')
    formData.append('files', new File(['image'], 'cover image.JPG', { type: 'image/jpeg' }))

    const res = await POST(
      new NextRequest('http://localhost/api/creator/media', {
        method: 'POST',
        body: formData,
      }),
    )

    expect(res.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(mockUpload.mock.calls[0]?.[0]).toContain('creators/creator-1/storefront/cover/')
    expect(mockUpload.mock.calls[0]?.[0]).toContain('cover-image.jpg')
    await expect(res.json()).resolves.toEqual({
      paths: [expect.stringContaining('creators/creator-1/storefront/cover/')],
    })
  })
})
