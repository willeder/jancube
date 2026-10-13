import Link from 'next/link'
import type { ReactNode } from 'react'

/** ‹ 前の画面に戻る + page title (C-13〜C-20). */
export function PageHeader({
  backHref,
  title,
  badge,
}: {
  backHref: string
  title: string
  badge?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-md px-4 pt-3 print:hidden">
      <Link href={backHref} className="text-sm font-bold text-brand-dark">
        ‹ 前の画面に戻る
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{title}</h1>
        {badge}
      </div>
    </div>
  )
}

const BADGE_STYLES = {
  confirmed: 'bg-brand-pale text-brand-dark',
  provisional: 'bg-gold-pale text-ink',
  used: 'bg-line/60 text-sub',
  canceled: 'bg-alert-pale text-alert',
} as const

const BADGE_LABELS = {
  confirmed: '確定',
  provisional: '仮割当',
  used: '利用済',
  canceled: 'キャンセル済',
} as const

export type BadgeKind = keyof typeof BADGE_STYLES

/** C-12 / C-13 booking status badge. */
export function StatusBadge({ kind }: { kind: BadgeKind }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE_STYLES[kind]}`}>
      {BADGE_LABELS[kind]}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white p-4 text-sm ${className}`}>
      {children}
    </section>
  )
}

export function Row({
  label,
  value,
  accent,
}: {
  label: string
  value: ReactNode
  accent?: 'brand' | 'alert'
}) {
  const color = accent === 'brand' ? 'text-brand' : accent === 'alert' ? 'text-alert' : ''
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sub">{label}</dt>
      <dd className={`text-right font-bold ${color}`}>{value}</dd>
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'warn' | 'alert'
  children: ReactNode
}) {
  const styles = {
    info: 'bg-brand-pale text-brand-dark',
    success: 'border border-brand bg-brand-pale text-brand-dark',
    warn: 'bg-gold-pale text-ink',
    alert: 'bg-alert-pale text-alert',
  }
  return (
    <p
      role={tone === 'alert' ? 'alert' : undefined}
      className={`rounded-lg p-3 text-sm ${styles[tone]}`}
    >
      {children}
    </p>
  )
}

export const buttonPrimary =
  'block w-full rounded-xl bg-brand py-3 text-center font-bold text-white disabled:opacity-60'
export const buttonOutline =
  'block w-full rounded-xl border border-brand bg-white py-3 text-center font-bold text-brand'
export const buttonDanger =
  'block w-full rounded-xl bg-alert py-3 text-center font-bold text-white disabled:opacity-60'
