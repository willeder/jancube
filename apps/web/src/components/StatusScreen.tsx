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
    <main className="customer-content">
      <section className="rounded-[14px] border border-alert/30 bg-alert-pale p-3.5">
        <h1 className="font-bold text-alert">
          <span aria-hidden>{icon}</span> {title}
        </h1>
        {children && <div className="mt-1.5 text-xs text-sub">{children}</div>}
        {action && (
          <Link
            href={action.href}
            className="mt-2 block w-full rounded-[9px] border-[1.5px] border-brand bg-white px-3.5 py-[7px] text-center text-[13px] font-bold text-brand-dark"
          >
            {action.label}
          </Link>
        )}
      </section>
    </main>
  )
}
