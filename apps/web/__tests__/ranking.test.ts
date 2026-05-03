import { describe, expect, it } from 'vitest';

import {
  getTripKitAccessReasonLabel,
  getTripKitAccessRank,
  getViewerCreatorAccessLevel,
  rankSavedKitsForViewer,
  rankTripKitsForViewer,
  partitionStorefrontTripKits,
  tripKitRankingOrder,
} from '../lib/ranking';

describe('tripKitRankingOrder', () => {
  it('prioritizes featured kits, then engagement, then freshness', () => {
    expect(tripKitRankingOrder).toEqual([
      { isFeatured: 'desc' },
      { viewCount: 'desc' },
      { saveCount: 'desc' },
      { updatedAt: 'desc' },
    ]);
  });
});

describe('partitionStorefrontTripKits', () => {
  const kits = [
    { id: 'featured-1', isFeatured: true },
    { id: 'featured-2', isFeatured: true },
    { id: 'featured-3', isFeatured: true },
    { id: 'featured-4', isFeatured: true },
    { id: 'recent-1', isFeatured: false },
    { id: 'recent-2', isFeatured: false },
    { id: 'recent-3', isFeatured: false },
    { id: 'recent-4', isFeatured: false },
    { id: 'recent-5', isFeatured: false },
    { id: 'recent-6', isFeatured: false },
    { id: 'recent-7', isFeatured: false },
  ];

  it('keeps featured and recent kits in ranked order with default limits', () => {
    const result = partitionStorefrontTripKits(kits);

    expect(result.featuredKits.map((kit) => kit.id)).toEqual([
      'featured-1',
      'featured-2',
      'featured-3',
    ]);
    expect(result.recentKits.map((kit) => kit.id)).toEqual([
      'recent-1',
      'recent-2',
      'recent-3',
      'recent-4',
      'recent-5',
      'recent-6',
    ]);
  });

  it('supports custom creator portal limits', () => {
    const result = partitionStorefrontTripKits(kits, {
      featuredLimit: 2,
      recentLimit: 2,
    });

    expect(result.featuredKits.map((kit) => kit.id)).toEqual([
      'featured-1',
      'featured-2',
    ]);
    expect(result.recentKits.map((kit) => kit.id)).toEqual([
      'recent-1',
      'recent-2',
    ]);
  });

  it('returns empty groups when there are no kits', () => {
    const result = partitionStorefrontTripKits([]);

    expect(result.featuredKits).toEqual([]);
    expect(result.recentKits).toEqual([]);
  });
});

describe('getViewerCreatorAccessLevel', () => {
  it('treats the creator owner as premium access', () => {
    expect(
      getViewerCreatorAccessLevel({
        isFollowing: false,
        hasPremiumSubscription: false,
        isOwner: true,
      }),
    ).toBe('PREMIUM');
  });

  it('treats premium subscriptions as premium access', () => {
    expect(
      getViewerCreatorAccessLevel({
        isFollowing: true,
        hasPremiumSubscription: true,
      }),
    ).toBe('PREMIUM');
  });

  it('treats follows as follower access when there is no premium subscription', () => {
    expect(
      getViewerCreatorAccessLevel({
        isFollowing: true,
        hasPremiumSubscription: false,
      }),
    ).toBe('FOLLOWER');
  });

  it('falls back to free access otherwise', () => {
    expect(
      getViewerCreatorAccessLevel({
        isFollowing: false,
        hasPremiumSubscription: false,
      }),
    ).toBe('FREE');
  });
});

describe('getTripKitAccessRank', () => {
  it('prefers premium kits for premium viewers', () => {
    expect(getTripKitAccessRank('PREMIUM', 'PREMIUM')).toBe(0);
    expect(getTripKitAccessRank('FOLLOWER', 'PREMIUM')).toBe(1);
    expect(getTripKitAccessRank('FREE', 'PREMIUM')).toBe(1);
  });

  it('prefers follower kits for follower viewers and leaves premium locked last', () => {
    expect(getTripKitAccessRank('FOLLOWER', 'FOLLOWER')).toBe(0);
    expect(getTripKitAccessRank('FREE', 'FOLLOWER')).toBe(1);
    expect(getTripKitAccessRank('PREMIUM', 'FOLLOWER')).toBe(2);
  });

  it('keeps free kits first for free viewers', () => {
    expect(getTripKitAccessRank('FREE', 'FREE')).toBe(0);
    expect(getTripKitAccessRank('FOLLOWER', 'FREE')).toBe(1);
    expect(getTripKitAccessRank('PREMIUM', 'FREE')).toBe(1);
  });
});

describe('getTripKitAccessReasonLabel', () => {
  it('explains when a premium kit is included with the viewer subscription', () => {
    expect(getTripKitAccessReasonLabel('PREMIUM', 'PREMIUM')).toBe(
      'Included with your subscription',
    );
  });

  it('explains when a follower kit is unlocked by following', () => {
    expect(getTripKitAccessReasonLabel('FOLLOWER', 'FOLLOWER')).toBe(
      'Unlocked by following',
    );
    expect(getTripKitAccessReasonLabel('FOLLOWER', 'PREMIUM')).toBe(
      'Unlocked by following',
    );
  });

  it('returns no label for free kits or still-locked content', () => {
    expect(getTripKitAccessReasonLabel('FREE', 'FREE')).toBeNull();
    expect(getTripKitAccessReasonLabel('PREMIUM', 'FOLLOWER')).toBeNull();
    expect(getTripKitAccessReasonLabel('FOLLOWER', 'FREE')).toBeNull();
  });
});

describe('rankTripKitsForViewer', () => {
  it('reorders kits by viewer access while preserving ranked order within each bucket', () => {
    const kits = [
      { id: 'free-1', creatorId: 'creator-a', accessTier: 'FREE', isFeatured: true },
      { id: 'premium-1', creatorId: 'creator-a', accessTier: 'PREMIUM', isFeatured: true },
      { id: 'follower-1', creatorId: 'creator-b', accessTier: 'FOLLOWER', isFeatured: false },
      { id: 'free-2', creatorId: 'creator-b', accessTier: 'FREE', isFeatured: false },
    ] as const;

    const ranked = rankTripKitsForViewer(kits, {
      'creator-a': 'PREMIUM',
      'creator-b': 'FOLLOWER',
    });

    expect(ranked.map((kit) => kit.id)).toEqual([
      'premium-1',
      'follower-1',
      'free-1',
      'free-2',
    ]);
  });

  it('defaults unknown creators to free access', () => {
    const kits = [
      { id: 'premium-locked', creatorId: 'creator-a', accessTier: 'PREMIUM', isFeatured: false },
      { id: 'free-open', creatorId: 'creator-b', accessTier: 'FREE', isFeatured: false },
    ] as const;

    const ranked = rankTripKitsForViewer(kits, {});

    expect(ranked.map((kit) => kit.id)).toEqual([
      'free-open',
      'premium-locked',
    ]);
  });
});

describe('rankSavedKitsForViewer', () => {
  it('lifts accessible saved kits ahead of locked ones while preserving saved order inside buckets', () => {
    const savedKits = [
      { id: 'saved-1', tripKit: { id: 'premium-locked', creatorId: 'creator-a', accessTier: 'PREMIUM' } },
      { id: 'saved-2', tripKit: { id: 'follower-open', creatorId: 'creator-b', accessTier: 'FOLLOWER' } },
      { id: 'saved-3', tripKit: { id: 'free-open', creatorId: 'creator-c', accessTier: 'FREE' } },
      { id: 'saved-4', tripKit: { id: 'premium-open', creatorId: 'creator-d', accessTier: 'PREMIUM' } },
    ] as const;

    const ranked = rankSavedKitsForViewer(savedKits, {
      'creator-b': 'FOLLOWER',
      'creator-d': 'PREMIUM',
    });

    expect(ranked.map((savedKit) => savedKit.id)).toEqual([
      'saved-2',
      'saved-3',
      'saved-4',
      'saved-1',
    ]);
  });

  it('keeps original order when access ranks are the same', () => {
    const savedKits = [
      { id: 'saved-1', tripKit: { id: 'free-1', creatorId: 'creator-a', accessTier: 'FREE' } },
      { id: 'saved-2', tripKit: { id: 'free-2', creatorId: 'creator-b', accessTier: 'FREE' } },
    ] as const;

    const ranked = rankSavedKitsForViewer(savedKits, {});

    expect(ranked.map((savedKit) => savedKit.id)).toEqual([
      'saved-1',
      'saved-2',
    ]);
  });
});
