import { describe, expect, it } from 'vitest'
import { getVlogProcessingPresentation } from '../lib/vlogProcessing'

describe('getVlogProcessingPresentation', () => {
  it('maps internal pipeline states to creator-friendly in-progress copy', () => {
    expect(getVlogProcessingPresentation('TRANSCRIPT_DONE')).toEqual(
      expect.objectContaining({
        label: 'Continuing video processing',
        inProgress: true,
      }),
    )

    expect(getVlogProcessingPresentation('RANKED')).toEqual(
      expect.objectContaining({
        label: 'Preparing review queue',
        inProgress: true,
      }),
    )
  })

  it('maps review readiness to a clear creator-facing state', () => {
    expect(getVlogProcessingPresentation('REVIEW_PENDING')).toEqual(
      expect.objectContaining({
        label: 'Ready for review',
        inProgress: false,
      }),
    )
  })
})
