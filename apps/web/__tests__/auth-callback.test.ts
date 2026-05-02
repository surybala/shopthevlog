import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockExchangeCodeForSession = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdateUserById = vi.fn();
const mockIsWhitelisted = vi.fn();
const mockIsAdmin = vi.fn();
const mockHasAdminMetadata = vi.fn();
const mockIsAdminUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
      },
    },
  }),
}));

vi.mock('@/lib/prisma/client', () => ({
  default: {
    waitlistRequest: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    creator: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/whitelist', () => ({
  isWhitelisted: (...args: unknown[]) => mockIsWhitelisted(...args),
}));

vi.mock('@/lib/admin', () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
  hasAdminMetadata: (...args: unknown[]) => mockHasAdminMetadata(...args),
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}));

import { GET } from '../app/auth/callback/route';

describe('auth callback whitelist behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'admin@vlogshopper.com',
          app_metadata: {},
          user_metadata: {},
        },
      },
    });
    mockSignOut.mockResolvedValue({});
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(null);
    mockUpdateUserById.mockResolvedValue({});
    mockIsWhitelisted.mockReturnValue(false);
    mockIsAdmin.mockReturnValue(true);
    mockHasAdminMetadata.mockReturnValue(false);
    mockIsAdminUser.mockReturnValue(true);
  });

  it('lets admins through even when not whitelisted', async () => {
    const response = await GET(new NextRequest('http://localhost/auth/callback?code=abc&next=/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          approved: true,
          admin: true,
          is_admin: true,
          role: 'admin',
        }),
      })
    );
  });
});
