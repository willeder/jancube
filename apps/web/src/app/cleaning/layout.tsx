import type { Metadata } from 'next'

export const metadata: Metadata = { title: '雀CUBE 清掃' }

/** K-01–K-04 share the compact cleaning shell and expose no customer information. */
export default function CleaningLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cleaning-shell">
      <header className="cleaning-header">
        <span className="font-bold">🧹 雀CUBE 清掃</span>
        <span className="text-[11px] text-[#d8e6df]">清掃担当ロール専用画面</span>
      </header>
      <main className="cleaning-content">{children}</main>
    </div>
  )
}
