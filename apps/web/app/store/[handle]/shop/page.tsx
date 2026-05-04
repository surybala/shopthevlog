import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma/client'
import { getStorefrontTheme } from '@/lib/storefrontThemes'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const creator = await prisma.creator.findUnique({ where: { handle: params.handle }, select: { displayName: true } })
  return { title: `Shop - ${creator?.displayName ?? params.handle} - TripKits` }
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

  const physicalItems = creator.merchandise.filter((item) => item.type === 'PHYSICAL')
  const digitalItems = creator.merchandise.filter((item) => item.type === 'DIGITAL')
  const affiliateItems = creator.merchandise.filter((item) => item.type === 'AFFILIATE')
  const theme = getStorefrontTheme(creator.storefrontTheme)

  return (
    <div
      className="storefront-shell mx-auto max-w-6xl px-6 py-12"
      style={{ ...theme.cssVars, backgroundImage: `var(--storefront-page-bg), url(${theme.storefrontBackdropImageUrl})` }}
    >
      <div className="mb-10">
        <Link href={`/@${creator.handle}`} className="storefront-muted mb-4 inline-block text-sm hover:text-[var(--storefront-text)]">
          &larr; {creator.displayName}
        </Link>
        <h1 className="storefront-heading text-3xl font-bold">Shop</h1>
        <p className="storefront-muted mt-1">{creator.merchandise.length} products</p>
      </div>

      {creator.merchandise.length === 0 ? (
        <div className="storefront-muted py-24 text-center">No products yet.</div>
      ) : (
        <div className="space-y-12">
          {physicalItems.length > 0 && (
            <section>
              <h2 className="storefront-heading mb-4 text-lg font-semibold">Merch</h2>
              <div className="grid grid-cols-4 gap-4">
                {physicalItems.map((item) => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
          {digitalItems.length > 0 && (
            <section>
              <h2 className="storefront-heading mb-4 text-lg font-semibold">Digital Downloads</h2>
              <div className="grid grid-cols-4 gap-4">
                {digitalItems.map((item) => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
          {affiliateItems.length > 0 && (
            <section>
              <h2 className="storefront-heading mb-4 text-lg font-semibold">Gear Picks</h2>
              <div className="grid grid-cols-4 gap-4">
                {affiliateItems.map((item) => <MerchCard key={item.id} item={item} handle={creator.handle} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function MerchCard({
  item,
  handle,
}: {
  item: { id: string; title: string; slug: string; coverImageUrl: string; price: number | null; currency: string; type: string }
  handle: string
}) {
  return (
    <Link href={`/@${handle}/shop/${item.slug}`} className="storefront-card group overflow-hidden">
      <div className="storefront-surface aspect-square overflow-hidden border-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolveStorageAssetUrl(item.coverImageUrl) ?? ''} alt={item.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
      </div>
      <div className="p-4">
        <p className="storefront-heading truncate text-sm font-medium">{item.title}</p>
        <div className="mt-1 flex items-center justify-between">
          <p className="storefront-muted text-xs">
            {item.type === 'AFFILIATE' ? 'Affiliate' : item.price !== null ? `$${(item.price / 100).toFixed(0)}` : 'Free'}
          </p>
          <p className="storefront-muted text-xs capitalize">{item.type.toLowerCase()}</p>
        </div>
      </div>
    </Link>
  )
}
