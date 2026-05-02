import * as Sentry from '@sentry/nextjs'

function getServerDsn() {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
}

export async function register() {
  const dsn = getServerDsn()

  if (!dsn) {
    return
  }

  const sharedConfig = {
    dsn,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      ...sharedConfig,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    })
    return
  }

  Sentry.init({
    ...sharedConfig,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0'),
  })
}

export const onRequestError = Sentry.captureRequestError
