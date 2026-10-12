import Link from 'next/link'
import type { ReactNode } from 'react'

/** C-21 エラー/期限切れ/メンテナンス: one screen pattern, shown per state. */
export function StatusScreen({
  icon,
  title,
  children,
  action,
}: {
  icon: string
  title: string
  children?: ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <section className="rounded-xl border border-line bg-white p-6 text-center">
        <div aria-hidden className="text-4xl">
          {icon}
        </div>
        <h1 className="mt-3 text-lg font-bold">{title}</h1>
        {children && <div className="mt-2 text-sm text-sub">{children}</div>}
      </section>
      {action && (
        <Link
          href={action.href}
          className="mt-5 block w-full rounded-xl bg-brand py-3 text-center font-bold text-white"
        >
          {action.label}
        </Link>
      )}
    </main>
  )
}
