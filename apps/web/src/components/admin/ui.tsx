import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Admin UI primitives (A-xx screens). Desktop-first (Figma frames are 1440px wide) but usable on a
 * tablet. Keep screens consistent by using these instead of ad-hoc markup.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="admin-page-header mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-bold">{title}</h1>
        {description && <p className="mt-3 text-[13px] text-sub">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`admin-card rounded-[14px] border border-line bg-white p-3.5 ${className}`}>
      {title && <h2 className="mb-2 text-[14px] font-bold">{title}</h2>}
      {children}
    </section>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="admin-stat rounded-xl border border-line bg-white px-4 py-[11px]">
      <div className="text-[22px] font-bold text-brand-dark">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-sub">{label}</div>
    </div>
  )
}

/** Simple table: pass header labels and rows of cells. */
export function Table({
  head,
  rows,
  empty = '該当するデータはありません',
  minWidth,
}: {
  head: ReactNode[]
  rows: ReactNode[][]
  empty?: string
  /** Keep dense operational tables readable inside their local scroll container. */
  minWidth?: number
}) {
  return (
    <div className="admin-table min-w-0 overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-left text-[12.5px]" style={minWidth ? { minWidth } : undefined}>
        <thead className="bg-brand-pale text-[11.5px] text-brand-dark">
          <tr>
            {head.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static header order
              <th key={i} className="whitespace-nowrap px-[11px] py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-sub">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are re-rendered as a whole
              <tr key={r} className="hover:bg-paper">
                {cells.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                  <td key={c} className="px-[11px] py-2 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

type Tone = 'green' | 'gold' | 'red' | 'gray'
const toneClass: Record<Tone, string> = {
  green: 'bg-brand-pale text-brand-dark',
  gold: 'bg-gold-pale text-[#8a6d1c]',
  red: 'bg-alert-pale text-alert',
  gray: 'bg-paper text-sub border border-line',
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-[3px] text-[11px] font-bold ${toneClass[tone]}`}
    >
      {children}
    </span>
  )
}

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center rounded-[9px] bg-brand px-3.5 py-[7px] text-[13px] font-bold text-white disabled:opacity-60',
  secondary:
    'inline-flex items-center justify-center rounded-[9px] border-[1.5px] border-brand bg-white px-3.5 py-[7px] text-[13px] font-bold text-brand disabled:opacity-60',
  danger:
    'inline-flex items-center justify-center rounded-[9px] bg-alert px-3.5 py-[7px] text-[13px] font-bold text-white disabled:opacity-60',
} as const

export const inputClass =
  'w-full min-w-0 rounded-lg border-[1.5px] border-line bg-white px-3 py-[9px] text-sm'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block text-sm">
      <span className="mb-1 block text-[12.5px] font-bold text-sub">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sub">{hint}</span>}
    </label>
  )
}

export function Notice({
  tone = 'gold',
  children,
}: {
  tone?: 'gold' | 'red' | 'green'
  children: ReactNode
}) {
  const cls =
    tone === 'red'
      ? 'bg-alert-pale text-alert'
      : tone === 'green'
        ? 'bg-brand-pale text-brand-dark'
        : 'bg-gold-pale text-[#7a6420]'
  return (
    <p
      role={tone === 'red' ? 'alert' : undefined}
      className={`rounded-lg px-3 py-2 text-[11.5px] ${cls}`}
    >
      {children}
    </p>
  )
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-bold text-brand-dark underline-offset-2 hover:underline">
      {children}
    </Link>
  )
}
