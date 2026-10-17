import Link from 'next/link'
import type { ReactNode } from 'react'

/** ‹ 前の画面に戻る + page title (C-13〜C-20). */
export function PageHeader({
  backHref,
  title,
  badge,
  storeName,
}: {
  backHref: string
  title: string
  badge?: ReactNode
  storeName?: string
}) {
  return (
    <div className="customer-page-header print:hidden">
      <Link href={backHref} className="text-[13px] font-bold text-brand-dark">
        ‹ 前の画面に戻る
      </Link>
      {storeName && <div className="booking-store mt-3">📍 {storeName}</div>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <h1 className="text-base font-bold">{title}</h1>
        {badge}
      </div>
    </div>
  )
}

const BADGE_STYLES = {
  confirmed: 'bg-brand-pale text-brand-dark',
  provisional: 'bg-gold-pale text-[#8a6d1c]',
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
    <span
      className={`shrink-0 rounded-full px-2 py-[3px] text-[11px] font-bold ${BADGE_STYLES[kind]}`}
    >
      {BADGE_LABELS[kind]}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`customer-card rounded-[14px] border border-line bg-white p-3.5 text-[12.5px] ${className}`}
    >
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
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-sub">{label}</dt>
      <dd className={`min-w-0 text-right font-bold ${color}`}>{value}</dd>
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
    warn: 'bg-gold-pale text-[#7a6420]',
    alert: 'bg-alert-pale text-alert',
  }
  return (
    <p
      role={tone === 'alert' ? 'alert' : undefined}
      className={`rounded-lg px-3 py-2 text-[11.5px] ${styles[tone]}`}
    >
      {children}
    </p>
  )
}

export const buttonPrimary =
  'block w-full rounded-xl bg-brand px-3 py-[13px] text-center text-[15px] font-bold text-white disabled:opacity-60'
export const buttonOutline =
  'block w-full rounded-xl border-[1.5px] border-brand bg-white px-3 py-[13px] text-center text-[15px] font-bold text-brand-dark'
export const buttonDanger =
  'block w-full rounded-xl bg-alert px-3 py-[13px] text-center text-[15px] font-bold text-white disabled:opacity-60'
