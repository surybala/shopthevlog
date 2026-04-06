import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Shop — ${creator?.displayName ?? params.handle} — VlogShopper` }
}

export default async function StorefrontShopPage({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    include: {
      merchandise: {
        where: { isPublished: true },
        orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: { variants: true },
      },
    },
  })

  if (!creator || !creator.isPublished) notFound()

  const physicalItems = creator.merchandise.filter(m => m.type === 'PHYSICAL')
  const digitalItems = creator.merchandise.filter(m => m.type === 'DIGITAL')
  const affiliateItems = creator.merchandise.filter(m => m.type === 'AFFILIATE')

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10">
        <Link href={`/@${creator.handle}`} className="text-sm text-white/40 hover:text-white mb-4 inline-block">← {creator.displayName}</Link>
        <h1 className="text-3xl font-bold text-white">Shop</h1>
        <p className="text-white/40 mt-1">{creator.merchandise.length} products</p>
      </div>

      {creator.merchandise.length === 0 ? (
        <div className="text-center py-24 text-white/30">No products yet.</div>
      ) : (
        <div className="space-y-12">
          {physicalItems.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">Merch</h2>
              <div className="grid grid-cols-4 gap-4">
                {physicalItems.map(item => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
          {digitalItems.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">Digital Downloads</h2>
              <div className="grid grid-cols-4 gap-4">
                {digitalItems.map(item => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
          {affiliateItems.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">Gear Picks</h2>
              <div className="grid grid-cols-4 gap-4">
                {affiliateItems.map(item => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function MerchCard({ item, handle }: {
  item: { id: string; title: string; slug: string; coverImageUrl: string; price: number | null; currency: string; type: string }
  handle: string
}) {
  return (
    <Link href={`/@${handle}/shop/${item.slug}`} className="glass-card overflow-hidden group">
      <div className="aspect-square bg-white/5 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
      <div className="p-4">
        <p className="text-sm font-medium text-white truncate">{item.title}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-white/50">
            {item.type === 'AFFILIATE' ? 'Affiliate' : item.price !== null ? `$${(item.price / 100).toFixed(0)}` : 'Free'}
          </p>
          <p className="text-xs text-white/30 capitalize">{item.type.toLowerCase()}</p>
        </div>
      </div>
    </Link>
  )
}
