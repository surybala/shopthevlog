import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { PATCH, POST } from '../app/api/creator/profile/route';

describe('creator profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'creator-1', handle: 'creator', displayName: 'Creator' });
    mockUpdate.mockResolvedValue({ id: 'creator-1', handle: 'creator', displayName: 'Updated' });
  });

  it('POST returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(new NextRequest('http://localhost/api/creator/profile', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
  });

  it('POST returns 409 when the creator profile already exists', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'creator-1' });
    const res = await POST(new NextRequest('http://localhost/api/creator/profile', { method: 'POST', body: JSON.stringify({ handle: 'creator', displayName: 'Creator' }) }));
    expect(res.status).toBe(409);
  });

  it('POST validates the request body', async () => {
    const res = await POST(new NextRequest('http://localhost/api/creator/profile', { method: 'POST', body: JSON.stringify({ handle: 'Bad Handle', displayName: '' }) }));
    expect(res.status).toBe(422);
  });

  it('POST returns 409 when the handle is already taken', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'creator-2', handle: 'creator' });
    const res = await POST(new NextRequest('http://localhost/api/creator/profile', { method: 'POST', body: JSON.stringify({ handle: 'creator', displayName: 'Creator' }) }));
    expect(res.status).toBe(409);
  });

  it('POST creates the creator profile', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const res = await POST(new NextRequest('http://localhost/api/creator/profile', {
      method: 'POST',
      body: JSON.stringify({
        handle: 'creator',
        displayName: 'Creator',
        websiteUrl: 'https://example.com',
        storefrontTheme: 'BEACH_RETREAT',
        storefrontTagline: 'Salt, sun, and soft landings',
        storefrontIntro: 'Come for the beaches, stay for the food.',
        storefrontMoodImageUrl: 'creators/creator-1/creator portal/mood/mood.jpg',
        storefrontGalleryImages: ['creators/creator-1/creator portal/gallery/one.jpg', 'creators/creator-1/creator portal/gallery/two.jpg'],
      }),
    }));
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        handle: 'creator',
        displayName: 'Creator',
        bio: null,
        location: null,
        websiteUrl: 'https://example.com',
        storefrontTheme: 'BEACH_RETREAT',
        storefrontTagline: 'Salt, sun, and soft landings',
        storefrontIntro: 'Come for the beaches, stay for the food.',
        storefrontMoodImageUrl: 'creators/creator-1/creator portal/mood/mood.jpg',
        storefrontGalleryImages: ['creators/creator-1/creator portal/gallery/one.jpg', 'creators/creator-1/creator portal/gallery/two.jpg'],
      },
    });
    expect(res.status).toBe(201);
  });

  it('PATCH validates creator portal theme and gallery images', async () => {
    mockFindUnique.mockResolvedValue({ id: 'creator-1', handle: 'creator' });
    const res = await PATCH(new NextRequest('http://localhost/api/creator/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        storefrontTheme: 'NOT_A_THEME',
        storefrontGalleryImages: ['https://example.com/one.jpg'],
      }),
    }));

    expect(res.status).toBe(422);
  });

  it('PATCH returns 404 when the creator profile does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PATCH(new NextRequest('http://localhost/api/creator/profile', { method: 'PATCH', body: JSON.stringify({ displayName: 'Updated' }) }));
    expect(res.status).toBe(404);
  });

  it('PATCH returns 400 when isPublished is not a boolean', async () => {
    mockFindUnique.mockResolvedValue({ id: 'creator-1', handle: 'creator' });
    const res = await PATCH(new NextRequest('http://localhost/api/creator/profile', { method: 'PATCH', body: JSON.stringify({ isPublished: 'yes' }) }));
    expect(res.status).toBe(400);
  });

  it('PATCH returns 409 when changing to a taken handle', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'creator-1', handle: 'creator' })
      .mockResolvedValueOnce({ id: 'creator-2', handle: 'taken' });
    const res = await PATCH(new NextRequest('http://localhost/api/creator/profile', { method: 'PATCH', body: JSON.stringify({ handle: 'taken' }) }));
    expect(res.status).toBe(409);
  });

  it('PATCH updates the creator profile', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'creator-1', handle: 'creator' });
    const res = await PATCH(new NextRequest('http://localhost/api/creator/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: 'Updated',
        isPublished: true,
        storefrontTheme: 'FOOD_TRAIL',
        storefrontTagline: 'Eat first, plan later',
        storefrontGalleryImages: ['creators/creator-1/creator portal/gallery/gallery.jpg'],
      }),
    }));
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: {
        displayName: 'Updated',
        isPublished: true,
        storefrontTheme: 'FOOD_TRAIL',
        storefrontTagline: 'Eat first, plan later',
        storefrontGalleryImages: ['creators/creator-1/creator portal/gallery/gallery.jpg'],
      },
    });
    expect(res.status).toBe(200);
  });
});
