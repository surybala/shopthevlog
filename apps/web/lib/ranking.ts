export const tripKitRankingOrder = [
  { isFeatured: 'desc' },
  { viewCount: 'desc' },
  { saveCount: 'desc' },
  { updatedAt: 'desc' },
] as const;

export type TripKitAccessTier = 'FREE' | 'FOLLOWER' | 'PREMIUM';
export type ViewerCreatorAccessLevel = 'FREE' | 'FOLLOWER' | 'PREMIUM';

type StorefrontRankedKit = {
  isFeatured: boolean;
};

type AccessAwareKit = StorefrontRankedKit & {
  creatorId: string;
  accessTier: TripKitAccessTier;
};

type AccessAwareSavedKit<TTripKit extends {
  creatorId: string;
  accessTier: TripKitAccessTier;
}> = {
  tripKit: TTripKit;
};

type StorefrontPartitionOptions = {
  featuredLimit?: number;
  recentLimit?: number;
};

export function getViewerCreatorAccessLevel({
  isFollowing,
  hasPremiumSubscription,
  isOwner = false,
}: {
  isFollowing: boolean;
  hasPremiumSubscription: boolean;
  isOwner?: boolean;
}): ViewerCreatorAccessLevel {
  if (isOwner || hasPremiumSubscription) {
    return 'PREMIUM';
  }

  if (isFollowing) {
    return 'FOLLOWER';
  }

  return 'FREE';
}

export function getTripKitAccessRank(
  accessTier: TripKitAccessTier,
  accessLevel: ViewerCreatorAccessLevel,
) {
  if (accessLevel === 'PREMIUM') {
    if (accessTier === 'PREMIUM') return 0;
    return 1;
  }

  if (accessLevel === 'FOLLOWER') {
    if (accessTier === 'FOLLOWER') return 0;
    if (accessTier === 'FREE') return 1;
    return 2;
  }

  if (accessTier === 'FREE') return 0;
  return 1;
}

export function getTripKitAccessReasonLabel(
  accessTier: TripKitAccessTier,
  accessLevel: ViewerCreatorAccessLevel,
) {
  if (accessTier === 'PREMIUM' && accessLevel === 'PREMIUM') {
    return 'Included with your subscription';
  }

  if (accessTier === 'FOLLOWER' && (accessLevel === 'FOLLOWER' || accessLevel === 'PREMIUM')) {
    return 'Unlocked by following';
  }

  return null;
}

export function rankTripKitsForViewer<T extends AccessAwareKit>(
  kits: T[],
  accessByCreatorId: Record<string, ViewerCreatorAccessLevel>,
) {
  return kits
    .map((kit, index) => ({
      index,
      kit,
      accessRank: getTripKitAccessRank(
        kit.accessTier,
        accessByCreatorId[kit.creatorId] ?? 'FREE',
      ),
    }))
    .sort((a, b) => a.accessRank - b.accessRank || a.index - b.index)
    .map(({ kit }) => kit);
}

export function rankSavedKitsForViewer<
  T extends AccessAwareSavedKit<{
    creatorId: string;
    accessTier: TripKitAccessTier;
  }>
>(
  savedKits: T[],
  accessByCreatorId: Record<string, ViewerCreatorAccessLevel>,
) {
  return savedKits
    .map((savedKit, index) => ({
      index,
      savedKit,
      accessRank: getTripKitAccessRank(
        savedKit.tripKit.accessTier,
        accessByCreatorId[savedKit.tripKit.creatorId] ?? 'FREE',
      ),
    }))
    .sort((a, b) => a.accessRank - b.accessRank || a.index - b.index)
    .map(({ savedKit }) => savedKit);
}

export function partitionStorefrontTripKits<T extends StorefrontRankedKit>(
  kits: T[],
  options: StorefrontPartitionOptions = {},
) {
  const {
    featuredLimit = 3,
    recentLimit = 6,
  } = options;

  return {
    featuredKits: kits.filter((kit) => kit.isFeatured).slice(0, featuredLimit),
    recentKits: kits.filter((kit) => !kit.isFeatured).slice(0, recentLimit),
  };
}
