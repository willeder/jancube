import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '雀CUBE 予約' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <header className="bg-brand text-white">
          <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
            <span className="font-bold">🀄 雀CUBE 予約</span>
            <span className="text-xs opacity-80">jancube.net</span>
          </div>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
