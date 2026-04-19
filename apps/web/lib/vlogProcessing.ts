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

export function getVlogProcessingPresentation(status: string | null | undefined): {
  label: string
  tone: string
  inProgress: boolean
} {
  const normalized = (status ?? '').toUpperCase()

  switch (normalized) {
    case 'PENDING':
      return { label: 'Ready to process', tone: 'bg-[#17332d]/8 text-[#17332d]/76', inProgress: false }
    case 'QUEUED':
      return { label: 'Starting video processing', tone: 'bg-blue-500/14 text-blue-900', inProgress: true }
    case 'TRANSCRIBING':
      return { label: 'Analyzing transcript', tone: 'bg-yellow-500/16 text-yellow-900 animate-pulse', inProgress: true }
    case 'TRANSCRIPT_DONE':
      return { label: 'Continuing video processing', tone: 'bg-yellow-500/16 text-yellow-900 animate-pulse', inProgress: true }
    case 'EXTRACTING':
      return { label: 'Analyzing video scenes', tone: 'bg-purple-500/16 text-purple-900 animate-pulse', inProgress: true }
    case 'VISION_DONE':
      return { label: 'Processing video details', tone: 'bg-purple-500/16 text-purple-900 animate-pulse', inProgress: true }
    case 'FUSED':
      return { label: 'Combining findings', tone: 'bg-orange-500/18 text-orange-900 animate-pulse', inProgress: true }
    case 'RESOLVED':
      return { label: 'Linking places and products', tone: 'bg-orange-500/18 text-orange-900 animate-pulse', inProgress: true }
    case 'RANKED':
      return { label: 'Preparing review queue', tone: 'bg-orange-500/18 text-orange-900 animate-pulse', inProgress: true }
    case 'EMBEDDING':
      return { label: 'Preparing recommendations', tone: 'bg-orange-500/18 text-orange-900 animate-pulse', inProgress: true }
    case 'REVIEW_PENDING':
      return { label: 'Ready for review', tone: 'bg-green-500/18 text-green-900', inProgress: false }
    case 'COMPLETE':
      return { label: 'Complete', tone: 'bg-green-500/18 text-green-900', inProgress: false }
    case 'FAILED':
      return { label: 'Failed', tone: 'bg-red-500/18 text-red-900', inProgress: false }
    default:
      return {
        label: normalized.includes('DONE') || normalized.includes('ING') ? 'Video processing in progress' : 'Processing update',
        tone: 'bg-[#17332d]/8 text-[#17332d]/76',
        inProgress: normalized.includes('DONE') || normalized.includes('ING'),
      }
  }
}
