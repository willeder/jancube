/** Customer-facing screens (C-xx): mobile-first with the 雀CUBE header. */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <span className="font-bold">🀄 雀CUBE 予約</span>
          <span className="text-xs opacity-80">jancube.net</span>
        </div>
      </header>
      {children}
    </>
  )
}
