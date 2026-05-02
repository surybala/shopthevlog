import * as Sentry from '@sentry/nextjs'

function hasSentryDsn() {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)
}

export function captureObservabilityAlert({
  source,
  severity,
  message,
  extra,
}: {
  source: string
  severity: 'warning' | 'error'
  message: string
  extra?: Record<string, unknown>
}) {
  if (!hasSentryDsn()) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setLevel(severity)
    scope.setTag('alert_source', source)
    scope.setTag('alert_kind', 'observability')
    for (const [key, value] of Object.entries(extra ?? {})) {
      scope.setExtra(key, value)
    }
    Sentry.captureMessage(message, severity)
  })
}
