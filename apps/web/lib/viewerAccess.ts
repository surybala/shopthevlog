import prisma from '@/lib/prisma/client';
import { getViewerCreatorAccessLevel } from '@/lib/ranking';

export function buildViewerCreatorAccessMapFromRelationships({
  followedCreatorIds,
  premiumCreatorIds,
}: {
  followedCreatorIds: Iterable<string>;
  premiumCreatorIds: Iterable<string>;
}) {
  const followingCreatorIds = new Set(followedCreatorIds);
  const premiumIds = new Set(premiumCreatorIds);
  const creatorIds = new Set([
    ...followingCreatorIds,
    ...premiumIds,
  ]);

  return Object.fromEntries(
    [...creatorIds].map((creatorId) => [
      creatorId,
      getViewerCreatorAccessLevel({
        isFollowing: followingCreatorIds.has(creatorId),
        hasPremiumSubscription: premiumIds.has(creatorId),
      }),
    ]),
  );
}

export async function getViewerCreatorAccessMap(userId?: string | null) {
  if (!userId) {
    return {};
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!subscriber) {
    return {};
  }

  const [follows, subscriptions] = await Promise.all([
    prisma.follow.findMany({
      where: { subscriberId: subscriber.id },
      select: { creatorId: true },
    }),
    prisma.subscription.findMany({
      where: { subscriberId: subscriber.id, status: 'ACTIVE' },
      select: {
        creatorId: true,
        tier: { select: { kitAccess: true } },
      },
    }),
  ]);

  return buildViewerCreatorAccessMapFromRelationships({
    followedCreatorIds: follows.map((follow) => follow.creatorId),
    premiumCreatorIds: subscriptions
      .filter((subscription) => subscription.tier.kitAccess === 'PREMIUM')
      .map((subscription) => subscription.creatorId),
  });
}
