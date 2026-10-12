'use client'

import type { BlockRoom } from '@jancube/application'
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { buttonClass, Field, inputClass, Notice } from '@/components/admin/ui'
import { type BlockState, createBlockAction } from '@/server/admin-booking-actions'

/** A-22 「ブロックを追加」: shows the colliding bookings when the block is refused. */
export function BlockForm({
  stores,
  today,
}: {
  stores: { id: number; code: string; name: string; rooms: BlockRoom[] }[]
  today: string
}) {
  const [state, action, pending] = useActionState<BlockState, FormData>(createBlockAction, {
    error: null,
  })
  const [storeId, setStoreId] = useState(stores[0]?.id ?? 0)
  const [allDay, setAllDay] = useState(true)
  const rooms = stores.find((s) => s.id === storeId)?.rooms ?? []
  const time = (iso: string) =>
    new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <form
      action={action}
      className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-4"
    >
      <Field label="店舗">
        <select
          name="storeId"
          value={storeId}
          onChange={(e) => setStoreId(Number(e.target.value))}
          className={inputClass}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="部屋">
        <select name="roomId" className={inputClass}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value="all">全室</option>
        </select>
      </Field>
      <Field label="開始日">
        <input type="date" name="dateFrom" defaultValue={today} required className={inputClass} />
      </Field>
      <Field label="終了日" hint="1日だけなら空欄（最長31日）">
        <input type="date" name="dateTo" className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="size-4 accent-brand"
        />
        終日（営業時間すべて）
      </label>
      {!allDay && (
        <>
          <Field label="開始時刻">
            <input
              type="time"
              name="start"
              step={1800}
              defaultValue="10:00"
              className={inputClass}
            />
          </Field>
          <Field label="終了時刻" hint="開始より前の時刻は翌日（深夜営業）">
            <input type="time" name="end" step={1800} defaultValue="14:00" className={inputClass} />
          </Field>
        </>
      )}
      <div className="col-span-2 md:col-span-4">
        <Field label="理由（必須）">
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="例: 設備メンテナンス（卓の修理）"
            className={inputClass}
          />
        </Field>
      </div>
      <div className="col-span-2 space-y-2 md:col-span-4">
        {state.error && <Notice tone="red">{state.error}</Notice>}
        {state.conflicts && state.conflicts.length > 0 && (
          <ul className="space-y-1 text-sm">
            {state.conflicts.map((c) => (
              <li key={c.bookingCode}>
                <Link
                  href={`/admin/bookings/${c.bookingCode}`}
                  className="font-bold text-brand-dark underline"
                >
                  {c.bookingCode}
                </Link>{' '}
                {time(c.start)}〜{time(c.end)} / {c.roomId === null ? '部屋未割当' : c.roomName}
                {c.status === 'draft' ? '（仮押さえ中）' : ''}
              </li>
            ))}
          </ul>
        )}
        {state.created !== undefined && (
          <Notice tone="green">{state.created}件のブロックを登録しました</Notice>
        )}
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? '確認しています…' : '＋ ブロックを追加'}
        </button>
      </div>
    </form>
  )
}
