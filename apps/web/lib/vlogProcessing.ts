export function formatVlogPipelineErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null

  const normalized = raw.toLowerCase()

  if (normalized.includes('invalid api key')) {
    return 'Video processing is temporarily unavailable. Please try again shortly.'
  }

  if (normalized.includes('no video formats found') || normalized.includes('yt-dlp')) {
    return 'We could not access this video for processing. Please try again later or choose another video.'
  }

  if (normalized.includes('no_opportunities_extracted')) {
    return 'We could not confidently build a Trip Kit from this video yet. Try another video or retry later.'
  }

  if (normalized.includes('visual_evidence_failed')) {
    return 'We had trouble analyzing the visuals from this video. Please try again later.'
  }

  if (normalized.includes('processing credits')) {
    return 'You have used all of your video processing credits for this month. Upgrade or wait until next month to process another video.'
  }

  if (normalized.includes('network')) {
    return 'We could not reach the processing service. Please try again in a moment.'
  }

  return 'Video processing did not complete. Please try again.'
}
