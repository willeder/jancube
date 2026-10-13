import type { Metadata } from 'next'

export const metadata: Metadata = { title: '雀CUBE 清掃' }

/** Cleaning staff screens (K-01〜K-03): phone-sized, no admin navigation, no customer data. */
export default function CleaningLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md bg-paper">
      <header className="flex items-center justify-between bg-brand px-4 py-3 text-white">
        <span className="font-bold">🧹 雀CUBE 清掃</span>
        <span className="text-xs opacity-80">清掃担当ロール専用画面</span>
      </header>
      <main className="space-y-4 px-4 py-4">{children}</main>
    </div>
  )
}
