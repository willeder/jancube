import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: '雀CUBE 予約' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
