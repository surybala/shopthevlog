import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockDownload = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: (...args: unknown[]) => mockDownload(...args),
      }),
    },
  }),
}))

import { GET } from '../app/api/media/route'

describe('media proxy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownload.mockResolvedValue({
      data: new Blob(['image-bytes'], { type: 'image/jpeg' }),
      error: null,
    })
  })

  it('rejects invalid paths', async () => {
    const res = await GET(new NextRequest('http://localhost/api/media?path=https://example.com/image.jpg'))
    expect(res.status).toBe(400)
  })

  it('downloads private storage assets through the app', async () => {
    const res = await GET(
      new NextRequest(
        'http://localhost/api/media?path=creators%2Fcreator-1%2Fstorefront%2Fcover%2Fcover.jpg',
      ),
    )

    expect(res.status).toBe(200)
    expect(mockDownload).toHaveBeenCalledWith('creators/creator-1/storefront/cover/cover.jpg')
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })
})
