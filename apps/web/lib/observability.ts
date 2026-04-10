import { captureObservabilityAlert } from '@/lib/externalMonitoring'

type ApiMetricEvent = {
  timestamp: number
  route: string
  status: number
  durationMs: number
  detail?: string
}

type ObservabilityState = {
  events: ApiMetricEvent[]
  alertCache: Record<string, number>
}

const EVENT_LIMIT = 500
const WINDOW_MS = 15 * 60 * 1000

function getState(): ObservabilityState {
  const globalKey = '__vlogshopperObservability'
  const globalValue = globalThis as typeof globalThis & {
    [globalKey]?: ObservabilityState
  }
  if (!globalValue[globalKey]) {
    globalValue[globalKey] = { events: [], alertCache: {} }
  }
  return globalValue[globalKey]!
}

export function recordApiObservation(route: string, status: number, durationMs: number, detail?: string) {
  const state = getState()
  state.events.push({
    timestamp: Date.now(),
    route,
    status,
    durationMs,
    detail,
  })
  if (state.events.length > EVENT_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_LIMIT)
  }
  maybeEmitExternalAlerts(route)
}

export function getApiObservabilitySnapshot(now = Date.now()) {
  const windowStart = now - WINDOW_MS
  const recentEvents = getState().events.filter((event) => event.timestamp >= windowStart)
  const grouped = new Map<string, ApiMetricEvent[]>()

  for (const event of recentEvents) {
    const current = grouped.get(event.route) ?? []
    current.push(event)
    grouped.set(event.route, current)
  }

  const routes = Array.from(grouped.entries()).map(([route, events]) => {
    const errors = events.filter((event) => event.status >= 500 || event.status === 429 || event.status === 503)
    const durations = events.map((event) => event.durationMs).sort((a, b) => a - b)
    const p95 = durations.length === 0
      ? null
      : durations[Math.min(durations.length - 1, Math.max(0, Math.floor(durations.length * 0.95) - 1))]
    return {
      route,
      total: events.length,
      errors: errors.length,
      errorRate: events.length === 0 ? 0 : Number((errors.length / events.length).toFixed(4)),
      p95DurationMs: p95 === null ? null : Number(p95.toFixed(2)),
    }
  })

  const alerts = routes.flatMap((route) => {
    const items: Array<{ severity: 'warning' | 'critical'; source: string; message: string }> = []
    if (route.total >= 5 && route.errorRate >= 0.1) {
      items.push({
        severity: route.errorRate >= 0.25 ? 'critical' : 'warning',
        source: route.route,
        message: `API error rate is ${(route.errorRate * 100).toFixed(1)}% over the last 15 minutes.`,
      })
    }
    if (route.p95DurationMs !== null && route.p95DurationMs > 2500) {
      items.push({
        severity: 'warning',
        source: route.route,
        message: `API p95 latency is ${route.p95DurationMs}ms over the last 15 minutes.`,
      })
    }
    return items
  })

  return {
    windowMs: WINDOW_MS,
    routes,
    alerts,
    recentEvents: recentEvents.slice(-25),
  }
}

export function resetApiObservabilityForTests() {
  const state = getState()
  state.events = []
  state.alertCache = {}
}

function maybeEmitExternalAlerts(route: string, now = Date.now()) {
  const state = getState()
  const windowStart = now - WINDOW_MS
  const events = state.events.filter((event) => event.timestamp >= windowStart && event.route === route)
  const errors = events.filter((event) => event.status >= 500 || event.status === 429 || event.status === 503)
  const durations = events.map((event) => event.durationMs).sort((a, b) => a - b)
  const p95 = durations.length === 0
    ? null
    : durations[Math.min(durations.length - 1, Math.max(0, Math.floor(durations.length * 0.95) - 1))]

  const candidates: Array<{ cacheKey: string; severity: 'warning' | 'error'; message: string }> = []
  if (events.length >= 5 && errors.length / events.length >= 0.1) {
    candidates.push({
      cacheKey: `${route}:error_rate`,
      severity: errors.length / events.length >= 0.25 ? 'error' : 'warning',
      message: `API error rate is ${(errors.length / events.length * 100).toFixed(1)}% over the last 15 minutes for ${route}.`,
    })
  }
  if (p95 !== null && p95 > 2500) {
    candidates.push({
      cacheKey: `${route}:latency`,
      severity: 'warning',
      message: `API p95 latency is ${p95.toFixed(2)}ms over the last 15 minutes for ${route}.`,
    })
  }

  for (const candidate of candidates) {
    const lastSentAt = state.alertCache[candidate.cacheKey]
    if (lastSentAt && lastSentAt >= windowStart) {
      continue
    }

    state.alertCache[candidate.cacheKey] = now
    captureObservabilityAlert({
      source: route,
      severity: candidate.severity,
      message: candidate.message,
      extra: {
        route,
        total: events.length,
        errors: errors.length,
        p95DurationMs: p95,
      },
    })
  }
}
