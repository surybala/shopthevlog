import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CREATOR_PLAN_CONFIG } from '../lib/creatorPlans'

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
const mockVlogFindMany = vi.fn()
const mockVlogFindUnique = vi.fn()
const mockVlogCount = vi.fn()
const mockVlogUpsert = vi.fn()
const mockRecordApiObservation = vi.fn()

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
      findMany: (...args: unknown[]) => mockVlogFindMany(...args),
      findUnique: (...args: unknown[]) => mockVlogFindUnique(...args),
      count: (...args: unknown[]) => mockVlogCount(...args),
      upsert: (...args: unknown[]) => mockVlogUpsert(...args),
    },
  },
}))

vi.mock('@/lib/observability', () => ({
  recordApiObservation: (...args: unknown[]) => mockRecordApiObservation(...args),
}))

import { POST as triggerScan } from '../app/api/creator/scan/route'
import { GET as previewScan, POST as previewVideoByUrl } from '../app/api/creator/scan/preview/route'

describe('creator scan trigger route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockRateLimit.mockReturnValue(false)
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      youtubeChannelId: 'channel-1',
      plan: 'PRO',
    })
    mockCreatorUpdate.mockResolvedValue({})
    mockVlogFindMany.mockResolvedValue([])
    mockCreatorChannelTokenFindUnique.mockResolvedValue({
      creatorId: 'creator-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockCreatorChannelTokenUpdate.mockResolvedValue({})
    mockVlogUpsert.mockResolvedValue({})
    mockVlogFindUnique.mockResolvedValue(null)
    mockVlogCount.mockResolvedValue(0)
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
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                id: 'video-1',
                contentDetails: { duration: 'PT15M9S' },
                statistics: { viewCount: '12345', likeCount: '678' },
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
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/creator/scan', 401, expect.any(Number), 'unauthorized')
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
      plan: 'PRO',
    })

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(400)
  })

  it('starts a scan, imports videos, and marks the scan complete', async () => {
    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'COMPLETE', importedCount: 1, limitReached: false })
    expect(mockRecordApiObservation).toHaveBeenCalledWith('/api/creator/scan', 200, expect.any(Number), 'scan_complete')

    await vi.waitFor(() => {
      expect(mockCreatorUpdate).toHaveBeenCalledWith({
        where: { id: 'creator-1' },
        data: { catalogScanStatus: 'SCANNING' },
      })
      expect(mockVlogUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { platform_externalId: { platform: 'YOUTUBE', externalId: 'video-1' } },
          create: expect.objectContaining({ durationSeconds: 909, viewCount: 12345, likeCount: 678 }),
          update: expect.objectContaining({ durationSeconds: 909, viewCount: 12345, likeCount: 678 }),
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

  it('default scan imports only the most recent 30 videos, newest first', async () => {
    const TOTAL = 35
    const items = Array.from({ length: TOTAL }, (_, i) => ({
      contentDetails: { videoId: `video-${i}` },
      snippet: {
        title: `Video ${i}`,
        description: 'd',
        // larger i => more recent
        publishedAt: new Date(2024, 0, 1 + i).toISOString(),
        thumbnails: { high: { url: 'https://img.example/x.jpg' } },
      },
    }))
    const videoStats = items.map((it) => ({
      id: it.contentDetails.videoId,
      contentDetails: { duration: 'PT5M' },
      statistics: { viewCount: '100', likeCount: '1' },
    }))

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } } }] }) })
        .mockResolvedValueOnce({ json: async () => ({ items }) })
        .mockResolvedValueOnce({ json: async () => ({ items: videoStats }) }),
    )
    mockVlogFindMany.mockResolvedValue([])

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'COMPLETE', importedCount: 30, limitReached: false })
    await vi.waitFor(() => {
      expect(mockVlogUpsert).toHaveBeenCalledTimes(30)
    })
    const importedIds = mockVlogUpsert.mock.calls.map(
      (c) => (c[0] as { where: { platform_externalId: { externalId: string } } }).where.platform_externalId.externalId,
    )
    // newest 30 imported; the 5 oldest excluded
    expect(importedIds).toContain('video-34')
    expect(importedIds).not.toContain('video-0')
    // imports default to PENDING (auto-transcribe is off)
    const createForNewest = mockVlogUpsert.mock.calls.find(
      (c) => (c[0] as { where: { platform_externalId: { externalId: string } } }).where.platform_externalId.externalId === 'video-34',
    )?.[0] as { create: { processingStatus: string } }
    expect(createForNewest.create.processingStatus).toBe('PENDING')
  })

  it('preview returns channel videos with imported state', async () => {
    mockVlogFindMany.mockResolvedValue([{ externalId: 'video-1', id: 'vlog-1', processingStatus: 'PENDING' }])

    const res = await previewScan(new NextRequest('http://localhost/api/creator/scan/preview?showImported=true'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      vlogLimit: 200,
      remainingVlogSlots: 199,
      videos: [
        expect.objectContaining({
          videoId: 'video-1',
          title: 'My Vlog',
          description: 'Desc',
          thumbnailUrl: 'https://img.example/1.jpg',
          publishedAt: '2024-01-01T00:00:00.000Z',
          durationSeconds: 909,
          viewCount: 12345,
          likeCount: 678,
          imported: true,
          importedVlogId: 'vlog-1',
          importedProcessingStatus: 'PENDING',
          insights: expect.objectContaining({
            score: expect.any(Number),
            recommendation: expect.any(String),
            headline: expect.any(String),
            primaryFit: expect.any(String),
            reasons: expect.any(Array),
          }),
        }),
      ],
    })
  })

  it('preview filters videos by query and excludes imported videos by default', async () => {
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
                  title: 'Tokyo Food Guide',
                  description: 'Desc',
                  publishedAt: '2024-01-01T00:00:00.000Z',
                  thumbnails: { high: { url: 'https://img.example/1.jpg' } },
                },
              },
              {
                contentDetails: { videoId: 'video-2' },
                snippet: {
                  title: 'Iceland Road Trip',
                  description: 'Desc 2',
                  publishedAt: '2024-01-02T00:00:00.000Z',
                  thumbnails: { high: { url: 'https://img.example/2.jpg' } },
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                id: 'video-1',
                contentDetails: { duration: 'PT11M' },
                statistics: { viewCount: '5000', likeCount: '200' },
              },
              {
                id: 'video-2',
                contentDetails: { duration: 'PT7M30S' },
                statistics: { viewCount: '8000', likeCount: '350' },
              },
            ],
          }),
        }),
    )
    mockVlogFindMany.mockResolvedValue([{ externalId: 'video-1', id: 'vlog-1', processingStatus: 'PENDING' }])

    const res = await previewScan(new NextRequest('http://localhost/api/creator/scan/preview?query=iceland'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      vlogLimit: 200,
      remainingVlogSlots: 199,
      videos: [
        expect.objectContaining({
          videoId: 'video-2',
          title: 'Iceland Road Trip',
          description: 'Desc 2',
          thumbnailUrl: 'https://img.example/2.jpg',
          publishedAt: '2024-01-02T00:00:00.000Z',
          durationSeconds: 450,
          viewCount: 8000,
          likeCount: 350,
          imported: false,
          importedVlogId: null,
          importedProcessingStatus: null,
          insights: expect.objectContaining({
            score: expect.any(Number),
            recommendation: expect.any(String),
            primaryFit: expect.any(String),
            reasons: expect.any(Array),
          }),
        }),
      ],
    })
  })

  it('preview can resolve a single video by pasted YouTube URL', async () => {
    const res = await previewVideoByUrl(
      new NextRequest('http://localhost/api/creator/scan/preview', {
        method: 'POST',
        body: JSON.stringify({ videoUrl: 'https://www.youtube.com/watch?v=video-1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      vlogLimit: 200,
      remainingVlogSlots: 200,
      video: expect.objectContaining({
        videoId: 'video-1',
        title: 'My Vlog',
        description: 'Desc',
        thumbnailUrl: 'https://img.example/1.jpg',
        publishedAt: '2024-01-01T00:00:00.000Z',
        durationSeconds: 909,
        viewCount: 12345,
        likeCount: 678,
        imported: false,
        importedVlogId: null,
        insights: expect.objectContaining({
          score: expect.any(Number),
          recommendation: expect.any(String),
          primaryFit: expect.any(String),
          reasons: expect.any(Array),
        }),
      }),
    })
  })

  it('imports only explicitly selected videos when videoIds are provided', async () => {
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
              {
                contentDetails: { videoId: 'video-2' },
                snippet: {
                  title: 'Skip Me',
                  description: 'Desc 2',
                  publishedAt: '2024-01-02T00:00:00.000Z',
                  thumbnails: { high: { url: 'https://img.example/2.jpg' } },
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                id: 'video-1',
                contentDetails: { duration: 'PT15M9S' },
                statistics: { viewCount: '100', likeCount: '10' },
              },
              {
                id: 'video-2',
                contentDetails: { duration: 'PT5M5S' },
                statistics: { viewCount: '200', likeCount: '20' },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }),
    )

    const res = await triggerScan(
      new NextRequest('http://localhost/api/creator/scan', {
        method: 'POST',
        body: JSON.stringify({ videoIds: ['video-2'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'COMPLETE', importedCount: 1, limitReached: false })
    expect(mockVlogUpsert).toHaveBeenCalledTimes(1)
    expect(mockVlogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform_externalId: { platform: 'YOUTUBE', externalId: 'video-2' } },
        create: expect.objectContaining({ durationSeconds: 305, viewCount: 200, likeCount: 20 }),
        update: expect.objectContaining({ durationSeconds: 305, viewCount: 200, likeCount: 20 }),
      }),
    )
  })

  it('does not import new videos once the creator has reached the plan video cap', async () => {
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      userId: 'user-1',
      youtubeChannelId: 'channel-1',
      plan: 'FREE',
    })
    // Creator is already AT the FREE import cap (none of which is the catalog's
    // new video-1), so the scan must import nothing and report the limit reached.
    mockVlogFindMany.mockResolvedValue(
      Array.from({ length: CREATOR_PLAN_CONFIG.FREE.maxImportedVlogs }, (_, i) => ({
        externalId: `existing-${i}`,
      })),
    )

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'COMPLETE', importedCount: 0, limitReached: true })
    await vi.waitFor(() => {
      expect(mockVlogUpsert).not.toHaveBeenCalled()
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
    mockCreatorChannelTokenFindUnique.mockResolvedValueOnce({
      creatorId: 'creator-1',
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() - 60_000),
    })
    mockCreatorChannelTokenFindUnique.mockResolvedValueOnce({
      creatorId: 'creator-1',
      accessToken: 'fresh-access',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() + 300_000),
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
        .mockResolvedValueOnce({
          json: async () => ({ items: [] }),
        })
    )

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'COMPLETE', importedCount: 0, limitReached: false })
    await vi.waitFor(() => {
      expect(mockCreatorChannelTokenUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { creatorId_platform: { creatorId: 'creator-1', platform: 'YOUTUBE' } },
          data: expect.objectContaining({ accessToken: 'fresh-access' }),
        })
      )
    })
  })

  it('returns reconnect required when YouTube token refresh fails before scanning', async () => {
    mockCreatorChannelTokenFindUnique.mockResolvedValue({
      creatorId: 'creator-1',
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() - 60_000),
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        json: async () => ({ error: 'invalid_grant' }),
      }),
    )

    const res = await triggerScan(new NextRequest('http://localhost/api/creator/scan', { method: 'POST' }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'Reconnect your YouTube channel to continue scanning.',
      reconnectRequired: true,
    })
  })

  it('preview returns reconnect required when YouTube auth can no longer refresh', async () => {
    mockCreatorChannelTokenFindUnique.mockResolvedValue({
      creatorId: 'creator-1',
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      tokenExpiry: new Date(Date.now() - 60_000),
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        json: async () => ({ error: 'invalid_grant' }),
      }),
    )

    const res = await previewScan(new NextRequest('http://localhost/api/creator/scan/preview'))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'Reconnect your YouTube channel to load your catalog.',
      reconnectRequired: true,
    })
  })
})
