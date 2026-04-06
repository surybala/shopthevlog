import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { handle: string }
}) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublished: true,
    },
  })

  if (!creator || !creator.isPublished) notFound()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-white/50 hover:text-white transition-colors">
            VlogShopper
          </Link>
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span>by</span>
            <Link href={`/@${creator.handle}`} className="font-medium text-white">
              {creator.displayName}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/@${creator.handle}/subscribe`} className="btn-primary text-sm py-1.5 px-4">
              Follow
            </Link>
          </div>
        </div>
      </nav>
      <div className="pt-14">{children}</div>
    </div>
  )
}
