'use client'

import { useActionState } from 'react'
import { changeSelectionAction, confirmHoldAction } from '@/server/booking-actions'

export function ConfirmForm({ capacity, guestCount }: { capacity: number; guestCount: number }) {
  const [state, action, pending] = useActionState(confirmHoldAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-center justify-between rounded-xl border border-line bg-white p-4 text-sm">
        <span className="font-bold">ご利用人数</span>
        <select
          name="guestCount"
          defaultValue={guestCount}
          className="rounded-lg border border-line px-3 py-1.5"
        >
          {Array.from({ length: capacity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}名
            </option>
          ))}
        </select>
      </label>
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

export function ChangeSelectionButton({ storeCode, date }: { storeCode: string; date: string }) {
  return (
    <form action={changeSelectionAction}>
      <input type="hidden" name="storeCode" value={storeCode} />
      <input type="hidden" name="date" value={date} />
      <button
        type="submit"
        className="w-full rounded-xl border border-brand py-3 font-bold text-brand"
      >
        ← 日時・お部屋を変更する
      </button>
    </form>
  )
}
