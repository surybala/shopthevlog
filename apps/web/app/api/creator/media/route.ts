import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024
const ALLOWED_KINDS = new Set(['cover', 'mood', 'gallery'])

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
}

function getCreatorMediaBucket() {
  return process.env.SUPABASE_CREATOR_MEDIA_BUCKET || 'ai-pipeline-assets'
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const formData = await req.formData()
  const kind = formData.get('kind')
  if (typeof kind !== 'string' || !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Invalid upload type.' }, { status: 400 })
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0)

  if (files.length === 0) {
    return NextResponse.json({ error: 'Select at least one image to upload.' }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const bucket = getCreatorMediaBucket()
  const uploadedPaths: string[] = []

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'Each image must be 8 MB or smaller.' }, { status: 400 })
    }

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const path = `creators/${creator.id}/storefront/${kind}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(
      file.name || `upload.${extension}`,
    )}`

    const arrayBuffer = await file.arrayBuffer()
    const upload = await admin.storage.from(bucket).upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

    if (upload.error) {
      return NextResponse.json({ error: 'Could not upload image right now.' }, { status: 500 })
    }

    uploadedPaths.push(path)
  }

  return NextResponse.json({ paths: uploadedPaths })
}
