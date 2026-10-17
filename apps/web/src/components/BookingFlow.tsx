import Link from 'next/link'
import type { ReactNode } from 'react'

const STEPS = ['店舗', '日付', '時間', '確認', 'お客様情報', 'お支払い', '完了'] as const

/** Shared C-01–C-11 layout. The Figma device bezel and review notes are not application UI. */
export function BookingFlow({
  step,
  backHref,
  storeName,
  children,
}: {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7
  backHref?: string
  storeName?: string
  children: ReactNode
}) {
  return (
    <>
      {backHref && (
        <nav className="booking-back" aria-label="前の画面">
          <Link href={backHref}>‹ 前の画面に戻る</Link>
        </nav>
      )}
      <ol className="booking-progress" aria-label="予約の進み具合">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step - 1 ? 'step' : undefined}>
            <span className="sr-only">{label}</span>
          </li>
        ))}
      </ol>
      <main className="booking-content">
        {storeName && <div className="booking-store">📍 {storeName}</div>}
        {children}
      </main>
    </>
  )
}
