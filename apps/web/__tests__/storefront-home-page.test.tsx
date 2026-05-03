import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockCreatorFindUnique = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
    },
  },
}));

import StorefrontHomePage from '../app/store/[handle]/page';

describe('StorefrontHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockCreatorFindUnique.mockResolvedValue({
      id: 'creator-1',
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      bio: 'Travel creator',
      avatarUrl: 'creators/creator-1/creator portal/avatar/avatar.jpg',
      coverImageUrl: 'creators/creator-1/creator portal/cover/cover.jpg',
      storefrontTheme: 'BEACH_RETREAT',
      storefrontTagline: 'Sunset itineraries and sea air',
      storefrontIntro: 'A creator portal shaped by swims, ferries, and long beach dinners.',
      storefrontMoodImageUrl: 'creators/creator-1/creator portal/mood/mood.jpg',
      storefrontGalleryImages: ['creators/creator-1/creator portal/gallery/gallery-1.jpg'],
      isPublished: true,
      location: 'Los Angeles',
      youtubeHandle: 'alexwanders',
      tiktokHandle: null,
      tripKits: [
        {
          id: 'kit-1',
          title: '10 Days in Japan',
          slug: 'japan-trip',
          coverImageUrl: null,
          sourceVlogs: [{ vlog: { thumbnailUrl: 'https://img.youtube.com/vi/japan/hqdefault.jpg' } }],
          primaryCity: 'Tokyo',
          countries: ['Japan'],
          durationDays: 10,
          accessTier: 'FREE',
          isFeatured: true,
          viewCount: 100,
          saveCount: 10,
          estimatedBudgetLow: 1200,
          estimatedBudgetHigh: 2200,
          travelStyle: ['CITY'],
        },
      ],
      merchandise: [],
      _count: {
        subscribers: 42,
      },
    });
  });

  it('renders published creator portal kits without crashing', async () => {
    const page = await StorefrontHomePage({ params: { handle: 'alexwanders' } });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Alex Wanders');
    expect(html).toContain('10 Days in Japan');
    expect(html).toContain('Featured Trip Kits');
    expect(html).toContain('Sunset itineraries and sea air');
    expect(html).not.toContain('What subscribers get');
    expect(html).not.toContain('Moodboard');
    expect(html).toContain('creator portal-shell');
    expect(html).toContain('text-[#17332d]');
    expect(html).toContain('--creator portal-page-bg');
    expect(html).toContain('background-image:var(--creator portal-page-bg)');
    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('/api/media?path=creators%2Fcreator-1%2Fstorefront%2Fcover%2Fcover.jpg');
    expect(html).toContain('https://img.youtube.com/vi/japan/hqdefault.jpg');
    expect(html).not.toContain('>KIT<');
  });
});
