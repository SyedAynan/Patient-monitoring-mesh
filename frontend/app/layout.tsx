import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { StarfieldCanvas } from '@/components/starfield-canvas'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Cosmic Mesh Monitor | Deep-Space Clinical Telemetry',
  description: 'Real-time patient telemetry, 3D mesh network visualizer, alert triage, and edge intelligence.',
  icons: {
    icon: [
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#000000',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="relative bg-black text-slate-100 antialiased">
        <StarfieldCanvas />
        <div className="relative z-10">{children}</div>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
