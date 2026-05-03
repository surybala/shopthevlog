const CHUNK_RECOVERY_PREFIX = 'tripkits:chunk-recovery:'
const CHUNK_RECOVERY_WINDOW_MS = 30_000

export function isChunkLoadIssue(input: unknown): boolean {
  if (!input) return false

  const message =
    typeof input === 'string'
      ? input
      : input instanceof Error
        ? `${input.name} ${input.message}`
        : typeof input === 'object' && 'message' in input
          ? String((input as { message?: unknown }).message ?? '')
          : ''

  const normalized = message.toLowerCase()

  return (
    normalized.includes('chunkloaderror') ||
    normalized.includes('loading chunk') ||
    normalized.includes('failed to fetch dynamically imported module')
  )
}

export function shouldRecoverChunk(pathname: string, now = Date.now()): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return false

  const key = `${CHUNK_RECOVERY_PREFIX}${pathname}`
  const lastAttempt = Number(sessionStorage.getItem(key) ?? '0')

  if (lastAttempt && now - lastAttempt < CHUNK_RECOVERY_WINDOW_MS) {
    return false
  }

  sessionStorage.setItem(key, String(now))
  return true
}

export function clearChunkRecovery(pathname: string) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(`${CHUNK_RECOVERY_PREFIX}${pathname}`)
}
