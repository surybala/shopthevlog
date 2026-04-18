const STORAGE_ASSET_PREFIX = 'creators/'

export function isStorageAssetPath(value: string | null | undefined): value is string {
  return !!value && !/^https?:\/\//i.test(value) && value.startsWith(STORAGE_ASSET_PREFIX)
}

export function buildStorageAssetUrl(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`
}

export function resolveStorageAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null
  return isStorageAssetPath(value) ? buildStorageAssetUrl(value) : value
}

export function resolveAbsoluteStorageAssetUrl(value: string | null | undefined): string | null {
  const resolved = resolveStorageAssetUrl(value)
  if (!resolved) return null
  if (/^https?:\/\//i.test(resolved)) return resolved

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  return baseUrl ? `${baseUrl}${resolved}` : resolved
}
