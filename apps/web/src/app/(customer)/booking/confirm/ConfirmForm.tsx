'use client'

import { type ReactNode, useActionState } from 'react'
import { changeSelectionAction, confirmHoldAction } from '@/server/booking-actions'

export function ConfirmForm({
  capacity,
  guestCount,
  children,
}: {
  capacity: number
  guestCount: number
  children?: ReactNode
}) {
  const [state, action, pending] = useActionState(confirmHoldAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <label className="block text-[12.5px] text-sub">
        <span className="font-bold">ご利用人数</span>
        <select
          name="guestCount"
          defaultValue={guestCount}
          className="mt-1 block w-full rounded-lg border border-line bg-white text-ink"
        >
          {Array.from({ length: capacity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}名
            </option>
          ))}
        </select>
      </label>
      {children}
      {state.error && (
        <p className="rounded-lg bg-alert-pale p-3 text-sm text-alert">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60"
      >
        お客様情報の入力へ
      </button>
    </form>
  )
}

export function ChangeSelectionButton({
  storeCode,
  date,
  compact = false,
  target = 'slots',
}: {
  storeCode: string
  date: string
  compact?: boolean
  target?: 'store' | 'date' | 'slots'
}) {
  return (
    <form action={changeSelectionAction} className={compact ? 'shrink-0' : undefined}>
      <input type="hidden" name="storeCode" value={storeCode} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="target" value={target} />
      <button
        type="submit"
        className={
          compact
            ? 'whitespace-nowrap text-xs font-bold text-brand-dark'
            : 'w-full rounded-xl border border-brand py-3 font-bold text-brand'
        }
      >
        {compact ? '変更' : '← 日時・お部屋を変更する'}
      </button>
    </form>
  )
}
