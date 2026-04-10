import { describe, expect, it } from 'vitest'

import { formatVlogPipelineErrorMessage } from '../lib/vlogProcessing'

describe('formatVlogPipelineErrorMessage', () => {
  it('hides internal API key errors', () => {
    expect(formatVlogPipelineErrorMessage('visual_evidence_failed: Invalid API key')).toBe(
      'Video processing is temporarily unavailable. Please try again shortly.',
    )
  })

  it('hides yt-dlp internals', () => {
    expect(formatVlogPipelineErrorMessage('yt-dlp player_client=ios failed: No video formats found')).toBe(
      'We could not access this video for processing. Please try again later or choose another video.',
    )
  })

  it('maps empty opportunity extraction to a user-friendly message', () => {
    expect(formatVlogPipelineErrorMessage('no_opportunities_extracted')).toBe(
      'We could not confidently build a Trip Kit from this video yet. Try another video or retry later.',
    )
  })

  it('falls back to a generic message', () => {
    expect(formatVlogPipelineErrorMessage('some_unknown_internal_error')).toBe(
      'Video processing did not complete. Please try again.',
    )
  })
})
