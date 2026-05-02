import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import { isStorageAssetPath } from '@/lib/storageAssets'

function getCreatorMediaBucket() {
  return process.env.SUPABASE_CREATOR_MEDIA_BUCKET || 'ai-pipeline-assets'
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path')

  if (!isStorageAssetPath(path)) {
    return NextResponse.json({ error: 'Invalid media path.' }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const bucket = getCreatorMediaBucket()
  const download = await admin.storage.from(bucket).download(path)

  if (download.error || !download.data) {
    return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
  }

  const blob = download.data
  const body = Buffer.from(await blob.arrayBuffer())

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
    },
  })
}
