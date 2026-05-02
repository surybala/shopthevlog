import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockCreatorFindUnique = vi.fn();
const mockChannelTokenUpsert = vi.fn();
const mockCreatorUpdate = vi.fn();
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
      update: (...args: unknown[]) => mockCreatorUpdate(...args),
    },
    creatorChannelToken: {
      upsert: (...args: unknown[]) => mockChannelTokenUpsert(...args),
    },
  },
}));

import { GET as youtubeCallback } from '../app/api/auth/youtube/callback/route';
import { GET as tiktokCallback } from '../app/api/auth/tiktok/callback/route';

describe('social auth callback routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1' });
    mockChannelTokenUpsert.mockResolvedValue({});
    mockCreatorUpdate.mockResolvedValue({});
    process.env.YOUTUBE_CLIENT_ID = 'yt-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'yt-secret';
    process.env.YOUTUBE_REDIRECT_URI = 'http://localhost/api/auth/youtube/callback';
    process.env.TIKTOK_CLIENT_KEY = 'tt-client';
    process.env.TIKTOK_CLIENT_SECRET = 'tt-secret';
    process.env.TIKTOK_REDIRECT_URI = 'http://localhost/api/auth/tiktok/callback';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('youtube callback redirects to denied when required params are missing', async () => {
    const req = new NextRequest('http://localhost/api/auth/youtube/callback');
    const res = await youtubeCallback(req);

    expect(res.headers.get('location')).toContain('error=youtube_denied');
  });

  it('youtube callback redirects to denied when state does not match the session', async () => {
    const req = new NextRequest('http://localhost/api/auth/youtube/callback?code=abc&state=other-user');
    const res = await youtubeCallback(req);

    expect(res.headers.get('location')).toContain('error=youtube_denied');
  });

  it('youtube callback exchanges tokens, stores the channel token, and redirects success', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: 'channel-1', snippet: { customUrl: '@creator', title: 'Creator Channel' } }],
      })));

    const req = new NextRequest('http://localhost/api/auth/youtube/callback?code=abc&state=user-1');
    const res = await youtubeCallback(req);

    expect(mockChannelTokenUpsert).toHaveBeenCalled();
    expect(mockCreatorUpdate).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { youtubeChannelId: 'channel-1', youtubeHandle: 'creator' },
    });
    expect(res.headers.get('location')).toContain('connected=youtube');
  });

  it('tiktok callback redirects to denied when state is invalid', async () => {
    const req = new NextRequest('http://localhost/api/auth/tiktok/callback?code=abc&state=other');
    const res = await tiktokCallback(req);

    expect(res.headers.get('location')).toContain('error=tiktok_denied');
  });

  it('tiktok callback redirects when the PKCE verifier cookie is missing', async () => {
    const req = new NextRequest('http://localhost/api/auth/tiktok/callback?code=abc&state=user-1');
    const res = await tiktokCallback(req);

    expect(res.headers.get('location')).toContain('error=tiktok_pkce_missing');
  });

  it('tiktok callback exchanges tokens, stores the channel token, clears the cookie, and redirects success', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_in: 7200, open_id: 'open-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: { open_id: 'open-1', username: 'tokuser' } } }), { status: 200 }));

    const req = new NextRequest('http://localhost/api/auth/tiktok/callback?code=abc&state=user-1', {
      headers: { cookie: 'tiktok_pkce_verifier=verifier-123' },
    });
    const res = await tiktokCallback(req);

    expect(mockChannelTokenUpsert).toHaveBeenCalled();
    expect(mockCreatorUpdate).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { tiktokUserId: 'open-1', tiktokHandle: 'tokuser' },
    });
    expect(res.headers.get('location')).toContain('connected=tiktok');
    expect(res.headers.get('set-cookie')).toContain('tiktok_pkce_verifier=');
  });
});
