'use client'

import { useEffect } from 'react'
import { clearChunkRecovery, isChunkLoadIssue, shouldRecoverChunk } from '@/lib/chunkRecovery'

export default function ChunkRecovery() {
  useEffect(() => {
    const pathname = window.location.pathname

    const clearTimer = window.setTimeout(() => {
      clearChunkRecovery(pathname)
    }, 5_000)

    function recover() {
      if (shouldRecoverChunk(window.location.pathname)) {
        window.location.reload()
      }
    }

    function onError(event: ErrorEvent) {
      if (isChunkLoadIssue(event.error ?? event.message)) {
        recover()
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadIssue(event.reason)) {
        recover()
      }
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.clearTimeout(clearTimer)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
