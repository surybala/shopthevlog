import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import ChunkRecovery from '@/components/ChunkRecovery'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

const metadataBase = (() => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  try {
    return new URL(baseUrl)
  } catch {
    return new URL('http://localhost:3000')
  }
})()

export const metadata: Metadata = {
  metadataBase,
  title: 'TripKits - The creator portal for travel vloggers',
  description:
    'TripKits is an AI-powered creator portal — grow your audience, benchmark your niche, and turn your travel vlogs into revenue when you\'re ready.',
  icons: {
    icon: [{ url: '/logo.png', type: 'image/png' }],
    apple: [{ url: '/logo.png', type: 'image/png' }],
    shortcut: '/logo.png',
  },
  openGraph: {
    title: 'TripKits',
    description: 'Creator-first vlog-based travel commerce platform',
    type: 'website',
    images: [{ url: '/logo.png', width: 1024, height: 1024, alt: 'TripKits' }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} text-[#17332d]`}>
        <ChunkRecovery />
        {children}
      </body>
    </html>
  )
}
