import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockRateLimit = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockCreatorFindUnique = vi.fn();
const mockTripKitCount = vi.fn();
const mockTripKitFindUnique = vi.fn();
const mockTripKitCreate = vi.fn();
const mockTripKitUpdate = vi.fn();
const mockTripKitDelete = vi.fn();
const mockDayFindFirst = vi.fn();
const mockDayCreate = vi.fn();
const mockDayFindUnique = vi.fn();
const mockDayUpdate = vi.fn();
const mockDayDelete = vi.fn();
const mockDayFindMany = vi.fn();
const mockActivityDeleteMany = vi.fn();

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: { findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args) },
    tripKit: {
      count: (...args: unknown[]) => mockTripKitCount(...args),
      findUnique: (...args: unknown[]) => mockTripKitFindUnique(...args),
      create: (...args: unknown[]) => mockTripKitCreate(...args),
      update: (...args: unknown[]) => mockTripKitUpdate(...args),
      delete: (...args: unknown[]) => mockTripKitDelete(...args),
    },
    itineraryDay: {
      findFirst: (...args: unknown[]) => mockDayFindFirst(...args),
      create: (...args: unknown[]) => mockDayCreate(...args),
      findUnique: (...args: unknown[]) => mockDayFindUnique(...args),
      update: (...args: unknown[]) => mockDayUpdate(...args),
      delete: (...args: unknown[]) => mockDayDelete(...args),
      findMany: (...args: unknown[]) => mockDayFindMany(...args),
    },
    dayActivity: {
      deleteMany: (...args: unknown[]) => mockActivityDeleteMany(...args),
    },
  },
}));

import { POST as createKit } from '../app/api/kits/route';
import { PATCH as updateKit, DELETE as deleteKit } from '../app/api/kits/[id]/route';
import { POST as createDay } from '../app/api/kits/[id]/days/route';
import { PATCH as updateDay, DELETE as deleteDay } from '../app/api/kits/[id]/days/[dayId]/route';

describe('kits CRUD routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockRateLimit.mockReturnValue(false);
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1', plan: 'PRO' });
    mockTripKitCount.mockResolvedValue(0);
    mockTripKitFindUnique.mockResolvedValue(null);
    mockTripKitCreate.mockResolvedValue({ id: 'kit-1', slug: 'tokyo' });
    mockTripKitUpdate.mockResolvedValue({ id: 'kit-1', title: 'Updated' });
    mockTripKitDelete.mockResolvedValue({});
    mockDayFindFirst.mockResolvedValue({ dayNumber: 2 });
    mockDayCreate.mockResolvedValue({ id: 'day-3', dayNumber: 3, activities: [] });
    mockDayFindUnique.mockResolvedValue({ id: 'day-1', tripKitId: 'kit-1', tripKit: { creatorId: 'creator-1' }, dayNumber: 2 });
    mockDayUpdate.mockResolvedValue({ id: 'day-1', title: 'Updated day', activities: [] });
    mockDayDelete.mockResolvedValue({});
    mockDayFindMany.mockResolvedValue([]);
    mockActivityDeleteMany.mockResolvedValue({});
  });

  it('create kit returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
  });

  it('create kit returns 403 when the creator profile is missing', async () => {
    mockCreatorFindUnique.mockResolvedValue(null);
    const res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'tokyo' }) }));
    expect(res.status).toBe(403);
  });

  it('create kit rate limits expensive requests', async () => {
    mockRateLimit.mockReturnValue(true);
    const res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'tokyo' }) }));
    expect(res.status).toBe(429);
  });

  it('create kit enforces the free-plan kit cap', async () => {
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', userId: 'user-1', plan: 'FREE' });
    mockTripKitCount.mockResolvedValue(3);
    const res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'tokyo' }) }));
    expect(res.status).toBe(403);
  });

  it('create kit validates budget ordering and slug format', async () => {
    let res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'Tokyo!', estimatedBudgetLow: 1000, estimatedBudgetHigh: 500 }) }));
    expect(res.status).toBe(422);

    res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'Tokyo!' }) }));
    expect(res.status).toBe(422);
  });

  it('create kit returns 409 for duplicate slugs', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-existing' });
    const res = await createKit(new NextRequest('http://localhost/api/kits', { method: 'POST', body: JSON.stringify({ title: 'Tokyo', slug: 'tokyo' }) }));
    expect(res.status).toBe(409);
  });

  it('create kit creates a new trip kit', async () => {
    const res = await createKit(new NextRequest('http://localhost/api/kits', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Tokyo',
        slug: 'tokyo',
        countries: ['Japan'],
        cities: ['Tokyo'],
        accessTier: 'FOLLOWER',
      }),
    }));
    expect(mockTripKitCreate).toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it('update kit returns 404 when the viewer does not own the kit', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', creatorId: 'other-creator' });
    const res = await updateKit(new NextRequest('http://localhost/api/kits/kit-1', { method: 'PATCH', body: JSON.stringify({ title: 'Updated' }) }), { params: { id: 'kit-1' } });
    expect(res.status).toBe(404);
  });

  it('update kit patches only supplied fields', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', creatorId: 'creator-1' });
    const res = await updateKit(new NextRequest('http://localhost/api/kits/kit-1', { method: 'PATCH', body: JSON.stringify({ title: 'Updated', isPublished: true }) }), { params: { id: 'kit-1' } });
    expect(mockTripKitUpdate).toHaveBeenCalledWith({
      where: { id: 'kit-1' },
      data: { title: 'Updated', isPublished: true },
    });
    expect(res.status).toBe(200);
  });

  it('delete kit removes an owned kit', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', creatorId: 'creator-1' });
    const res = await deleteKit(new NextRequest('http://localhost/api/kits/kit-1', { method: 'DELETE' }), { params: { id: 'kit-1' } });
    expect(mockTripKitDelete).toHaveBeenCalledWith({ where: { id: 'kit-1' } });
    expect(res.status).toBe(200);
  });

  it('create day returns 404 when the viewer does not own the kit', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', creatorId: 'other-creator' });
    const res = await createDay(new NextRequest('http://localhost/api/kits/kit-1/days', { method: 'POST', body: JSON.stringify({}) }), { params: { id: 'kit-1' } });
    expect(res.status).toBe(404);
  });

  it('create day increments the day number and returns 201', async () => {
    mockTripKitFindUnique.mockResolvedValue({ id: 'kit-1', creatorId: 'creator-1' });
    const res = await createDay(new NextRequest('http://localhost/api/kits/kit-1/days', { method: 'POST', body: JSON.stringify({ title: 'Day 3' }) }), { params: { id: 'kit-1' } });
    expect(mockDayCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ dayNumber: 3, title: 'Day 3' }),
    }));
    expect(res.status).toBe(201);
  });

  it('update day returns 404 when the viewer does not own the day', async () => {
    mockDayFindUnique.mockResolvedValue({ id: 'day-1', tripKitId: 'kit-1', tripKit: { creatorId: 'other-creator' } });
    const res = await updateDay(new NextRequest('http://localhost/api/kits/kit-1/days/day-1', { method: 'PATCH', body: JSON.stringify({ title: 'Updated' }) }), { params: { id: 'kit-1', dayId: 'day-1' } });
    expect(res.status).toBe(404);
  });

  it('update day patches the selected fields', async () => {
    const res = await updateDay(new NextRequest('http://localhost/api/kits/kit-1/days/day-1', { method: 'PATCH', body: JSON.stringify({ title: 'Updated', city: 'Tokyo' }) }), { params: { id: 'kit-1', dayId: 'day-1' } });
    expect(mockDayUpdate).toHaveBeenCalledWith({
      where: { id: 'day-1' },
      data: { title: 'Updated', city: 'Tokyo' },
      include: { activities: { orderBy: { sortOrder: 'asc' }, include: { affiliateLink: true } } },
    });
    expect(res.status).toBe(200);
  });

  it('delete day deletes activities, renumbers remaining days, and returns ok', async () => {
    mockDayFindMany.mockResolvedValue([
      { id: 'day-2', dayNumber: 2 },
      { id: 'day-4', dayNumber: 4 },
    ]);
    const res = await deleteDay(new NextRequest('http://localhost/api/kits/kit-1/days/day-1', { method: 'DELETE' }), { params: { id: 'kit-1', dayId: 'day-1' } });
    expect(mockActivityDeleteMany).toHaveBeenCalledWith({ where: { dayId: 'day-1' } });
    expect(mockDayDelete).toHaveBeenCalledWith({ where: { id: 'day-1' } });
    expect(mockDayUpdate).toHaveBeenCalledWith({
      where: { id: 'day-2' },
      data: { dayNumber: 1 },
    });
    expect(mockDayUpdate).toHaveBeenCalledWith({
      where: { id: 'day-4' },
      data: { dayNumber: 2 },
    });
    expect(res.status).toBe(200);
  });
});
