'use client'

import type { AvailabilityLane, DayAvailability, EndOption } from '@jancube/application'
import { useActionState, useState, useTransition } from 'react'
import { dateLabel, durationLabel, hhmm, yen } from '@/lib/format'
import { createHoldAction, getEndOptionsAction } from '@/server/booking-actions'

type Selection = { lane: AvailabilityLane; start: string; startMinute: number }

/** Interactive part of C-03: pick a start cell, then an end (cell or price chip). */
export function SlotPicker({ day }: { day: DayAvailability }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [ends, setEnds] = useState<EndOption[]>([])
  const [end, setEnd] = useState<EndOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pickStart(lane: AvailabilityLane, start: string, startMinute: number) {
    setSelection({ lane, start, startMinute })
    setEnd(null)
    setEnds([])
    setError(null)
    startTransition(async () => {
      const result = await getEndOptionsAction({
        storeCode: day.store.code,
        date: day.date,
        laneKey: lane.key,
        start,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.data.length === 0)
        setError('この時間からはご予約できません。別の開始時刻をお選びください')
      setEnds(result.data)
    })
  }

  function onCell(lane: AvailabilityLane, slot: AvailabilityLane['slots'][number]) {
    if (!slot.available) return
    // Second tap on the same row after the start: treat the tapped cell as the last 30 minutes.
    if (selection && selection.lane.key === lane.key && slot.minuteOfDay >= selection.startMinute) {
      const match = ends.find((e) => e.endMinuteOfDay === slot.minuteOfDay + 30)
      if (match) {
        setEnd(match)
        setError(null)
        return
      }
    }
    pickStart(lane, slot.start, slot.minuteOfDay)
  }

  const inRange = (lane: AvailabilityLane, minute: number) =>
    selection?.lane.key === lane.key &&
    minute >= selection.startMinute &&
    minute < (end?.endMinuteOfDay ?? selection.startMinute + 30)

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-24 bg-white p-2 text-left text-sub">
                部屋タイプ
              </th>
              {day.lanes[0]?.slots.map((s) => (
                <th key={s.start} className="min-w-8 p-1 text-center font-normal text-sub">
                  {s.minuteOfDay % 60 === 0 ? hhmm(s.minuteOfDay) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {day.lanes.map((lane) => (
              <tr key={lane.key} className="border-t border-line">
                <th className="sticky left-0 z-10 bg-white p-2 text-left align-top font-normal">
                  <div className="font-bold">{lane.label}</div>
                  <div className="text-sub">
                    {lane.kind === 'group' ? `全${lane.roomCount}室 · ` : `${lane.groupName} · `}
                    {yen(lane.hourlyRate)}/時
                  </div>
                </th>
                {lane.slots.map((s) => (
                  <td key={s.start} className="p-0.5 text-center">
                    <button
                      type="button"
                      disabled={!s.available || pending}
                      onClick={() => onCell(lane, s)}
                      aria-label={`${lane.label} ${hhmm(s.minuteOfDay)}`}
                      className={`h-8 w-7 rounded ${
                        inRange(lane, s.minuteOfDay)
                          ? 'bg-brand text-white'
                          : s.available
                            ? 'text-brand hover:bg-brand-pale'
                            : 'text-sub/40'
                      }`}
                    >
                      {s.available ? '◯' : '✕'}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 rounded-lg bg-alert-pale p-3 text-sm text-alert">{error}</p>}
      {pending && <p className="mt-3 text-sm text-sub">料金を計算しています…</p>}

      {selection && ends.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-bold">
            {selection.lane.label} / {hhmm(selection.startMinute)}開始 — 終了時刻を選ぶ
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ends.map((e) => (
              <button
                key={e.end}
                type="button"
                onClick={() => setEnd(e)}
                className={`rounded-lg border p-2 text-left text-xs ${
                  end?.end === e.end ? 'border-brand bg-brand-pale' : 'border-line bg-white'
                }`}
              >
                <div className="font-bold">{hhmm(e.endMinuteOfDay)}まで</div>
                <div>
                  {durationLabel(e.durationMinutes)} {yen(e.quote.price)}
                </div>
                {e.quote.discountAmount > 0 && (
                  <div className="text-brand">
                    −{yen(e.quote.discountAmount)}（{e.quote.discountRatePercent}%OFF）
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {selection && end && <Summary day={day} selection={selection} end={end} />}
    </div>
  )
}

function Summary({
  day,
  selection,
  end,
}: {
  day: DayAvailability
  selection: Selection
  end: EndOption
}) {
  const { quote } = end
  const [state, holdAction, holding] = useActionState(createHoldAction, { error: null })
  return (
    <section className="mt-4 rounded-xl border border-line bg-white p-4 text-sm">
      <div className="text-sub">
        選択中: {selection.lane.label} / {dateLabel(day.date)}
      </div>
      <dl className="mt-2 space-y-1">
        <Row
          label="開始〜終了"
          value={`${hhmm(selection.startMinute)} - ${hhmm(end.endMinuteOfDay)}`}
        />
        <Row label="時間数" value={durationLabel(end.durationMinutes)} />
        <Row label="通常料金" value={yen(quote.regularPrice)} />
        {quote.discountAmount > 0 && (
          <Row
            label="割引"
            value={`−${yen(quote.discountAmount)}（${quote.discountRatePercent}%OFF）`}
            accent
          />
        )}
        <div className="flex justify-between border-t border-line pt-2 font-bold">
          <dt>お支払い合計（税込）</dt>
          <dd className="text-lg text-brand-dark">{yen(quote.price)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-sub">クーポンはお支払い画面で適用できます</p>
      {state.error && (
        <p className="mt-3 rounded-lg bg-alert-pale p-3 text-sm text-alert">{state.error}</p>
      )}
      <form action={holdAction}>
        <input type="hidden" name="storeCode" value={day.store.code} />
        <input type="hidden" name="date" value={day.date} />
        <input type="hidden" name="laneKey" value={selection.lane.key} />
        <input type="hidden" name="start" value={selection.start} />
        <input type="hidden" name="end" value={end.end} />
        <button
          type="submit"
          disabled={holding}
          className="mt-3 w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60"
        >
          {holding ? 'お部屋を確保しています…' : 'この内容で進む'}
        </button>
      </form>
    </section>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-sub">{label}</dt>
      <dd className={accent ? 'text-brand' : ''}>{value}</dd>
    </div>
  )
}
