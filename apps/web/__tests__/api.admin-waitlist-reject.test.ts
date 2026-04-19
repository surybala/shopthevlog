import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetUser = vi.fn();
const mockRequireAdmin = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockIsAdminUser = vi.fn();
vi.mock('@/lib/admin', () => ({
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/prisma/client', () => ({
  default: {
    waitlistRequest: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { POST } from '../app/api/admin/waitlist/[id]/reject/route';

describe('POST /api/admin/waitlist/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'admin@example.com' } } });
    mockIsAdminUser.mockReturnValue(true);
    mockRequireAdmin.mockResolvedValue({ id: 'u-1', email: 'admin@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    mockUpdate.mockResolvedValue({});
  });

  it('returns 401 when the viewer is unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(new NextRequest('http://localhost/api/admin/waitlist/req-1/reject', { method: 'POST' }), { params: { id: 'req-1' } });

    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin viewers', async () => {
    mockIsAdminUser.mockReturnValue(false);
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const res = await POST(new NextRequest('http://localhost/api/admin/waitlist/req-1/reject', { method: 'POST' }), { params: { id: 'req-1' } });

    expect(res.status).toBe(403);
  });

  it('returns 404 when the request does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(new NextRequest('http://localhost/api/admin/waitlist/ghost/reject', { method: 'POST' }), { params: { id: 'ghost' } });

    expect(res.status).toBe(404);
  });

  it('returns already rejected when the request is already rejected', async () => {
    mockFindUnique.mockResolvedValue({ id: 'req-1', status: 'REJECTED' });

    const res = await POST(new NextRequest('http://localhost/api/admin/waitlist/req-1/reject', { method: 'POST' }), { params: { id: 'req-1' } });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, message: 'Already rejected' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates the request to rejected and returns ok', async () => {
    const res = await POST(new NextRequest('http://localhost/api/admin/waitlist/req-1/reject', { method: 'POST' }), { params: { id: 'req-1' } });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'REJECTED', rejectedAt: expect.any(Date) },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
