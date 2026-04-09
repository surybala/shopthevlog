import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

const mockCreatorFindUnique = vi.fn()
const mockCreatorUpdate = vi.fn()
const mockCreatorChannelTokenFindUnique = vi.fn()
const mockCreatorChannelTokenUpdate = vi.fn()
const mockVlogUpsert = vi.fn()

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
      update: (...args: unknown[]) => mockCreatorUpdate(...args),
    },
    creatorChannelToken: {
      findUnique: (...args: unknown[]) => mockCreatorChannelTokenFindUnique(...args),
      update: (...args: unknown[]) => mockCreatorChannelTokenUpdate(...args),
    },
    vlog: {
      upsert: (...args: unknown[]) => mockVlogUpsert(...args),
    },
  },
}))

import { POST as triggerScan } from '../app/api/creator/scan/route'

describe('creator scan trigger route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockRateLimit.mockReturnValue(false)
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      youtubeChannelId: 'channel-1',
    })
    mockCreatorUpdate.mockResolvedValue({})
    mockCreatorChannelTokenFindUnique.mockResolvedValue({
      creatorId: 'creator-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockCreatorChannelTokenUpdate.mockResolvedValue({})
    mockVlogUpsert.mockResolvedValue({})
    process.env.AI_PIPELINE_URL = 'http://ai.example.com'
    process.env.YOUTUBE_CLIENT_ID = 'yt-client'
    process.env.YOUTUBE_CLIENT_SECRET = 'yt-secret'

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                contentDetails: {
                  relatedPlaylists: { uploads: 'uploads-1' },
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                contentDetails: { videoId: 'video-1' },
                snippet: {
                  title: 'My Vlog',
                  description: 'Desc',
                  publishedAt: '2024-01-01T00:00:00.000Z',
                  thumbnails: { high: { url: 'https://img.example/1.jpg' } },
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    )
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(401)
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue(true)

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(429)
  })

  it('returns 404 when the creator does not exist', async () => {
    mockCreatorFindUnique.mockResolvedValue(null)

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when YouTube is not connected', async () => {
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      youtubeChannelId: null,
    })

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(400)
  })

  it('starts a scan, imports videos, and marks the scan complete', async () => {
    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'SCANNING' })

    await vi.waitFor(() => {
      expect(mockCreatorUpdate).toHaveBeenCalledWith({
        where: { id: 'creator-1' },
        data: { catalogScanStatus: 'SCANNING' },
      })
      expect(mockVlogUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { platform_externalId: { platform: 'YOUTUBE', externalId: 'video-1' } },
        })
      )
      expect(mockCreatorUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'creator-1' },
          data: expect.objectContaining({ catalogScanStatus: 'COMPLETE' }),
        })
      )
    })
  })

  it('refreshes an expired YouTube token before importing', async () => {
    mockCreatorChannelTokenFindUnique.mockResolvedValue({
      creatorId: 'creator-1',
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() - 60_000),
    })

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ access_token: 'fresh-access', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                contentDetails: {
                  relatedPlaylists: { uploads: 'uploads-1' },
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ items: [], nextPageToken: undefined }),
        })
    )

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(mockCreatorChannelTokenUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { creatorId_platform: { creatorId: 'creator-1', platform: 'YOUTUBE' } },
          data: expect.objectContaining({ accessToken: 'fresh-access' }),
        })
      )
    })
  })
})
