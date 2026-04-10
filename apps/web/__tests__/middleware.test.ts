import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockIsWhitelisted = vi.fn();
const mockIsAdminUser = vi.fn();
const mockGetE2EUserIdFromCookies = vi.fn();
const mockBuildE2EUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('@/lib/e2eAuth', () => ({
  getE2EUserIdFromCookies: (...args: unknown[]) => mockGetE2EUserIdFromCookies(...args),
  buildE2EUser: (...args: unknown[]) => mockBuildE2EUser(...args),
}));

vi.mock('@/lib/whitelist', () => ({
  isWhitelisted: (...args: unknown[]) => mockIsWhitelisted(...args),
}));

vi.mock('@/lib/admin', () => ({
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}));

import { middleware } from '../middleware';

describe('middleware whitelist enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetE2EUserIdFromCookies.mockReturnValue(null);
    mockBuildE2EUser.mockReturnValue(null);
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'creator@example.com',
          app_metadata: {},
        },
      },
    });
    mockIsWhitelisted.mockReturnValue(false);
    mockIsAdminUser.mockReturnValue(false);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'secret-key';
  });

  it('allows approved legacy users via waitlist lookup even without app_metadata.approved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'waitlist-1' }],
    }));

    const response = await middleware(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(200);
  });

  it('redirects to /waitlist when the user is not approved anywhere', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }));

    const response = await middleware(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/waitlist');
  });

  it('skips the waitlist lookup when app metadata already marks the user approved', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'creator@example.com',
          app_metadata: { approved: true },
        },
      },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await middleware(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows admins through without whitelist approval', async () => {
    mockIsAdminUser.mockReturnValue(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await middleware(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
