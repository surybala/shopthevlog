import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'VlogShopper — Creator-first travel storefronts',
  description: 'Turn your vlog back-catalog into a shoppable travel storefront. AI-powered Trip Kits, affiliate income, subscriber subscriptions.',
  openGraph: {
    title: 'VlogShopper',
    description: 'Creator-first vlog-based travel commerce platform',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
