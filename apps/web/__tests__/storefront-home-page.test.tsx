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
      avatarUrl: null,
      coverImageUrl: 'https://images.example.com/cover.jpg',
      storefrontTheme: 'BEACH_RETREAT',
      storefrontTagline: 'Sunset itineraries and sea air',
      storefrontIntro: 'A storefront shaped by swims, ferries, and long beach dinners.',
      storefrontMoodImageUrl: 'https://images.example.com/mood.jpg',
      storefrontGalleryImages: ['https://images.example.com/gallery-1.jpg'],
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

  it('renders published storefront kits without crashing', async () => {
    const page = await StorefrontHomePage({ params: { handle: 'alexwanders' } });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Alex Wanders');
    expect(html).toContain('10 Days in Japan');
    expect(html).toContain('Featured Trip Kits');
    expect(html).toContain('Sunset itineraries and sea air');
    expect(html).not.toContain('What subscribers get');
    expect(html).not.toContain('Moodboard');
    expect(html).toContain('storefront-shell');
    expect(html).toContain('text-[#17332d]');
    expect(html).toContain('--storefront-page-bg');
    expect(html).toContain('background-image:var(--storefront-page-bg)');
    expect(html).toContain('data:image/svg+xml');
  });
});
