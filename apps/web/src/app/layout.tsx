import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: '雀CUBE 予約' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased">
        <header className="bg-brand text-white">
          <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
            <span className="font-bold">🀄 雀CUBE 予約</span>
            <span className="text-xs opacity-80">jancube.net</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}
