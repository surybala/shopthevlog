import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

const mockCaptureObservabilityAlert = vi.fn()

vi.mock('@/lib/externalMonitoring', () => ({
  captureObservabilityAlert: (...args: unknown[]) => mockCaptureObservabilityAlert(...args),
}))

import {
  getApiObservabilitySnapshot,
  recordApiObservation,
  resetApiObservabilityForTests,
} from '../lib/observability'

describe('web observability helpers', () => {
  beforeEach(() => {
    resetApiObservabilityForTests()
    mockCaptureObservabilityAlert.mockReset()
  })

  it('aggregates route metrics and alerts on error rate', () => {
    for (let index = 0; index < 5; index += 1) {
      recordApiObservation('/api/example', index < 2 ? 503 : 200, 120 + index)
    }

    const snapshot = getApiObservabilitySnapshot()
    expect(snapshot.routes).toEqual([
      expect.objectContaining({
        route: '/api/example',
        total: 5,
        errors: 2,
      }),
    ])
    expect(snapshot.alerts).toEqual([
      expect.objectContaining({
        source: '/api/example',
      }),
    ])
    expect(mockCaptureObservabilityAlert).toHaveBeenCalledTimes(1)
    expect(mockCaptureObservabilityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: '/api/example',
      }),
    )
  })

  it('alerts on slow routes even without errors', () => {
    recordApiObservation('/api/slow', 200, 2600)
    const snapshot = getApiObservabilitySnapshot()
    expect(snapshot.alerts).toEqual([
      expect.objectContaining({
        source: '/api/slow',
        message: expect.stringContaining('p95 latency'),
      }),
    ])
    expect(mockCaptureObservabilityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: '/api/slow',
      }),
    )
  })

  it('dedupes repeated external alerts within the active window', () => {
    for (let index = 0; index < 6; index += 1) {
      recordApiObservation('/api/flaky', 503, 150)
    }

    expect(mockCaptureObservabilityAlert).toHaveBeenCalledTimes(1)
  })
})
