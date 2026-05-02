import { resolveStorageAssetUrl } from '@/lib/storageAssets'

type TripKitImageLike = {
  coverImageUrl?: string | null
  sourceVlogs?: Array<{
    vlog?: {
      thumbnailUrl?: string | null
    } | null
  }>
}

export function getTripKitCardImageUrl(kit: TripKitImageLike): string | null {
  return (
    resolveStorageAssetUrl(kit.coverImageUrl) ??
    resolveStorageAssetUrl(kit.sourceVlogs?.[0]?.vlog?.thumbnailUrl) ??
    null
  )
}
