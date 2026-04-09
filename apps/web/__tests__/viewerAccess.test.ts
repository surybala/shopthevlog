import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubscriberFindUnique = vi.fn();
const mockFollowFindMany = vi.fn();
const mockSubscriptionFindMany = vi.fn();

vi.mock('@/lib/prisma/client', () => ({
  default: {
    subscriber: {
      findUnique: (...args: unknown[]) => mockSubscriberFindUnique(...args),
    },
    follow: {
      findMany: (...args: unknown[]) => mockFollowFindMany(...args),
    },
    subscription: {
      findMany: (...args: unknown[]) => mockSubscriptionFindMany(...args),
    },
  },
}));

import {
  buildViewerCreatorAccessMapFromRelationships,
  getViewerCreatorAccessMap,
} from '../lib/viewerAccess';

describe('buildViewerCreatorAccessMapFromRelationships', () => {
  it('builds follower and premium access levels from relationship ids', () => {
    expect(
      buildViewerCreatorAccessMapFromRelationships({
        followedCreatorIds: ['creator-followed', 'creator-premium'],
        premiumCreatorIds: ['creator-premium'],
      }),
    ).toEqual({
      'creator-followed': 'FOLLOWER',
      'creator-premium': 'PREMIUM',
    });
  });

  it('returns an empty map when there are no relationships', () => {
    expect(
      buildViewerCreatorAccessMapFromRelationships({
        followedCreatorIds: [],
        premiumCreatorIds: [],
      }),
    ).toEqual({});
  });
});

describe('getViewerCreatorAccessMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscriberFindUnique.mockResolvedValue({ id: 'sub-1' });
    mockFollowFindMany.mockResolvedValue([]);
    mockSubscriptionFindMany.mockResolvedValue([]);
  });

  it('returns an empty map when there is no user id', async () => {
    await expect(getViewerCreatorAccessMap()).resolves.toEqual({});
    expect(mockSubscriberFindUnique).not.toHaveBeenCalled();
  });

  it('returns an empty map when the viewer has no subscriber record', async () => {
    mockSubscriberFindUnique.mockResolvedValue(null);

    await expect(getViewerCreatorAccessMap('user-1')).resolves.toEqual({});
    expect(mockFollowFindMany).not.toHaveBeenCalled();
    expect(mockSubscriptionFindMany).not.toHaveBeenCalled();
  });

  it('loads follows and active subscriptions for the subscriber', async () => {
    await getViewerCreatorAccessMap('user-1');

    expect(mockFollowFindMany).toHaveBeenCalledWith({
      where: { subscriberId: 'sub-1' },
      select: { creatorId: true },
    });
    expect(mockSubscriptionFindMany).toHaveBeenCalledWith({
      where: { subscriberId: 'sub-1', status: 'ACTIVE' },
      select: {
        creatorId: true,
        tier: { select: { kitAccess: true } },
      },
    });
  });

  it('maps creators to follower or premium access based on active relationships', async () => {
    mockFollowFindMany.mockResolvedValue([
      { creatorId: 'creator-followed' },
    ]);
    mockSubscriptionFindMany.mockResolvedValue([
      { creatorId: 'creator-followed', tier: { kitAccess: 'FOLLOWER' } },
      { creatorId: 'creator-premium', tier: { kitAccess: 'PREMIUM' } },
    ]);

    await expect(getViewerCreatorAccessMap('user-1')).resolves.toEqual({
      'creator-followed': 'FOLLOWER',
      'creator-premium': 'PREMIUM',
    });
  });
});
