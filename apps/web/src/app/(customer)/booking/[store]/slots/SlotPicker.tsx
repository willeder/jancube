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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]" aria-live="polite">
        <span
          className={`rounded-full px-2 py-[3px] font-bold ${!selection ? 'bg-brand-pale text-brand-dark' : 'bg-line/50 text-sub'}`}
        >
          ① 開始を選択
        </span>
        <span className="text-sub">→</span>
        <span
          className={`rounded-full px-2 py-[3px] font-bold ${selection ? 'bg-brand-pale text-brand-dark' : 'bg-line/50 text-sub'}`}
        >
          ② 終了を選択
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-max min-w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-20 min-w-20 bg-[#f6f5f1] px-1.5 py-1 text-left text-sub">
                部屋タイプ
              </th>
              {day.lanes[0]?.slots.map((s) => (
                <th
                  key={s.start}
                  className="min-w-6 bg-[#f6f5f1] px-0 py-1 text-center text-[9.5px] font-normal text-sub"
                >
                  {s.minuteOfDay % 60 === 0 ? hhmm(s.minuteOfDay) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {day.lanes.map((lane) => (
              <tr key={lane.key} className="border-t border-line">
                <th className="sticky left-0 z-10 w-20 min-w-20 max-w-20 bg-white px-1.5 py-1 text-left align-top font-normal">
                  <div className="font-bold">{lane.label}</div>
                  <div className="text-sub">
                    {lane.kind === 'group' ? `全${lane.roomCount}室 · ` : `${lane.groupName} · `}
                    {yen(lane.hourlyRate)}/時
                  </div>
                </th>
                {lane.slots.map((s) => (
                  <td key={s.start} className="border border-line/50 p-0 text-center">
                    <button
                      type="button"
                      disabled={!s.available || pending}
                      onClick={() => onCell(lane, s)}
                      aria-label={`${lane.label} ${hhmm(s.minuteOfDay)}`}
                      aria-pressed={Boolean(inRange(lane, s.minuteOfDay))}
                      className={`h-[34px] w-6 ${
                        inRange(lane, s.minuteOfDay)
                          ? 'bg-brand text-white'
                          : s.available
                            ? 'text-brand hover:bg-brand-pale'
                            : 'bg-line/20 text-sub/40'
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
          <fieldset className="mt-2 flex min-w-0 gap-2 overflow-x-auto pb-2">
            <legend className="sr-only">終了時刻と料金</legend>
            {ends.map((e) => (
              <button
                key={e.end}
                type="button"
                onClick={() => setEnd(e)}
                aria-pressed={end?.end === e.end}
                className={`min-w-[92px] shrink-0 rounded-xl border-[1.5px] px-3 py-[7px] text-center text-[10.5px] ${
                  end?.end === e.end ? 'border-brand bg-brand text-white' : 'border-line bg-white'
                }`}
              >
                <div className="text-[13.5px] font-bold">{hhmm(e.endMinuteOfDay)}</div>
                <div>
                  {durationLabel(e.durationMinutes)} {yen(e.quote.price)}
                </div>
                {e.quote.discountAmount > 0 && (
                  <div className={end?.end === e.end ? 'text-gold-pale' : 'text-alert'}>
                    −{yen(e.quote.discountAmount)}
                  </div>
                )}
              </button>
            ))}
          </fieldset>
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
    <section className="booking-card mt-3 text-[13px]">
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

        <div className="flex justify-between border-t border-line pt-2 font-bold">
          <dt>お支払い合計（税込）</dt>
          <dd className="text-[17px] text-brand-dark">{yen(quote.price)}</dd>
        </div>
        {quote.discountAmount > 0 && (
          <Row label="割引" value={`−${yen(quote.discountAmount)}`} accent />
        )}
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
        <button type="submit" disabled={holding} className="booking-primary mt-3">
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
      <dd className={accent ? 'text-alert' : ''}>{value}</dd>
    </div>
  )
}
