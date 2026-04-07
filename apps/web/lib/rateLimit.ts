/**
 * Simple in-process sliding-window rate limiter for Next.js API routes.
 *
 * Uses a Map keyed by `${userId}:${route}` with a rolling array of timestamps.
 * Suitable for single-instance dev and low-traffic production. For multi-instance
 * production, replace the Map with a Redis INCR + EXPIRE pattern.
 *
 * Usage in a route handler:
 *
 *   const limited = rateLimit(userId, 'kits:create', { limit: 20, windowMs: 60_000 })
 *   if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

interface Window {
  timestamps: number[]
}

const store = new Map<string, Window>()

// Periodically prune expired entries to avoid unbounded memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, win] of store.entries()) {
      if (win.timestamps.length === 0 || now - win.timestamps[win.timestamps.length - 1] > 300_000) {
        store.delete(key)
      }
    }
  }, 60_000)
}

export function rateLimit(
  identifier: string,
  route: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): boolean {
  const key = `${identifier}:${route}`
  const now = Date.now()
  const cutoff = now - windowMs

  const win = store.get(key) ?? { timestamps: [] }
  // Drop timestamps outside the window
  const recent = win.timestamps.filter(t => t > cutoff)
  recent.push(now)
  store.set(key, { timestamps: recent })

  return recent.length > limit
}
