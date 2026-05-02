import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockInit = vi.fn()
const mockCaptureRequestError = vi.fn()
const mockCaptureRouterTransitionStart = vi.fn()
const mockCaptureException = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureRequestError: mockCaptureRequestError,
  captureRouterTransitionStart: mockCaptureRouterTransitionStart,
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

vi.mock('next/error', () => ({
  default: ({ statusCode }: { statusCode: number }) => React.createElement('div', { 'data-status-code': String(statusCode) }, 'NextError'),
}))

describe('Sentry instrumentation', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  it('initializes Sentry for the node runtime inside register()', async () => {
    process.env.SENTRY_DSN = 'https://server@example.ingest.sentry.io/1'
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.2'
    process.env.SENTRY_PROFILES_SAMPLE_RATE = '0.3'
    process.env.NEXT_RUNTIME = 'nodejs'

    const instrumentation = await import('../instrumentation')
    await instrumentation.register()

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://server@example.ingest.sentry.io/1',
        tracesSampleRate: 0.2,
        profilesSampleRate: 0.3,
      }),
    )
    expect(instrumentation.onRequestError).toBe(mockCaptureRequestError)
  })

  it('initializes Sentry for the edge runtime inside register()', async () => {
    process.env.SENTRY_DSN = 'https://edge@example.ingest.sentry.io/1'
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.15'
    process.env.NEXT_RUNTIME = 'edge'

    const instrumentation = await import('../instrumentation')
    await instrumentation.register()

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://edge@example.ingest.sentry.io/1',
        tracesSampleRate: 0.15,
      }),
    )
    expect(mockInit.mock.calls[0][0]).not.toHaveProperty('profilesSampleRate')
  })

  it('initializes client-side Sentry from instrumentation-client', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://client@example.ingest.sentry.io/1'
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = '0.12'
    process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE = '0.01'
    process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE = '0.25'

    const instrumentationClient = await import('../instrumentation-client')

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://client@example.ingest.sentry.io/1',
        tracesSampleRate: 0.12,
        replaysSessionSampleRate: 0.01,
        replaysOnErrorSampleRate: 0.25,
      }),
    )
    expect(instrumentationClient.onRouterTransitionStart).toBe(mockCaptureRouterTransitionStart)
  })

  it('renders the global error boundary shell', async () => {
    const { default: GlobalError } = await import('../app/global-error')
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error('boom'), { digest: 'abc' })} />)

    expect(html).toContain('NextError')
    expect(html).toContain('data-status-code="0"')
  })
})
