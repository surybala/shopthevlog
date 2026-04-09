import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}));

import { GET as youtubeAuth } from '../app/api/auth/youtube/route';
import { GET as tiktokAuth } from '../app/api/auth/tiktok/route';

describe('social auth start routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    process.env.YOUTUBE_CLIENT_ID = 'yt-client';
    process.env.YOUTUBE_REDIRECT_URI = 'http://localhost/youtube/callback';
    process.env.TIKTOK_CLIENT_KEY = 'tt-client';
    process.env.TIKTOK_REDIRECT_URI = 'http://localhost/tiktok/callback';
  });

  it('youtube route returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await youtubeAuth();

    expect(res.status).toBe(401);
  });

  it('youtube route returns an oauth url with the viewer in state', async () => {
    const res = await youtubeAuth();
    const body = await res.json();

    expect(body.url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(body.url).toContain('client_id=yt-client');
    expect(body.url).toContain('state=user-1');
  });

  it('tiktok route returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await tiktokAuth();

    expect(res.status).toBe(401);
  });

  it('tiktok route returns 500 when oauth env vars are missing', async () => {
    delete process.env.TIKTOK_CLIENT_KEY;

    const res = await tiktokAuth();

    expect(res.status).toBe(500);
  });

  it('tiktok route redirects to authorize and sets the PKCE cookie', async () => {
    const res = await tiktokAuth();

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('https://www.tiktok.com/v2/auth/authorize/');
    expect(res.headers.get('location')).toContain('state=user-1');
    expect(res.headers.get('set-cookie')).toContain('tiktok_pkce_verifier=');
  });
});
