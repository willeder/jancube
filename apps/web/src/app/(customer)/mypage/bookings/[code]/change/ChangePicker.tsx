'use client'

import type { AvailabilityLane, DayAvailability, EndOption } from '@jancube/application'
import { useActionState, useState, useTransition } from 'react'
import { FormError } from '@/components/FormParts'
import { dateLabel, durationLabel, hhmm, yen } from '@/lib/format'
import {
  type ChangeQuoteView,
  changeBookingAction,
  getChangeEndOptionsAction,
  quoteChangeAction,
} from '@/server/mypage-actions'

type Selection = { lane: AvailabilityLane; start: string; startMinute: number }

/** C-14: the C-03 grid for the new time; the booking's own time counts as free. */
export function ChangePicker({
  bookingCode,
  day,
  currentTotal,
  requestKey,
}: {
  bookingCode: string
  day: DayAvailability
  currentTotal: number
  requestKey: string
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [ends, setEnds] = useState<EndOption[]>([])
  const [end, setEnd] = useState<EndOption | null>(null)
  const [quote, setQuote] = useState<ChangeQuoteView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pickStart(lane: AvailabilityLane, start: string, startMinute: number) {
    setSelection({ lane, start, startMinute })
    setEnd(null)
    setEnds([])
    setQuote(null)
    setError(null)
    startTransition(async () => {
      const result = await getChangeEndOptionsAction({
        bookingCode,
        date: day.date,
        laneKey: lane.key,
        start,
      })
      if (!result.ok) return setError(result.error)
      if (result.data.length === 0) {
        setError('この時間からはご予約できません。別の開始時刻をお選びください')
      }
      setEnds(result.data)
    })
  }

  function pickEnd(option: EndOption) {
    if (!selection) return
    setEnd(option)
    setQuote(null)
    setError(null)
    startTransition(async () => {
      const result = await quoteChangeAction({
        bookingCode,
        date: day.date,
        laneKey: selection.lane.key,
        start: selection.start,
        end: option.end,
      })
      if (!result.ok) return setError(result.error)
      setQuote(result.data)
    })
  }

  function onCell(lane: AvailabilityLane, slot: AvailabilityLane['slots'][number]) {
    if (!slot.available) return
    if (selection && selection.lane.key === lane.key && slot.minuteOfDay >= selection.startMinute) {
      const match = ends.find((e) => e.endMinuteOfDay === slot.minuteOfDay + 30)
      if (match) return pickEnd(match)
    }
    pickStart(lane, slot.start, slot.minuteOfDay)
  }

  const inRange = (lane: AvailabilityLane, minute: number) =>
    selection?.lane.key === lane.key &&
    minute >= selection.startMinute &&
    minute < (end?.endMinuteOfDay ?? selection.startMinute + 30)

  return (
    <div>
      <p className="text-sm text-sub">① 開始の◯をタップ → ② 終了を選ぶ（30分単位）</p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
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
                  <div className="text-sub">{yen(lane.hourlyRate)}/時</div>
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
      {pending && <p className="mt-3 text-sm text-sub">確認しています…</p>}

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
                onClick={() => pickEnd(e)}
                className={`rounded-lg border p-2 text-left text-xs ${
                  end?.end === e.end ? 'border-brand bg-brand-pale' : 'border-line bg-white'
                }`}
              >
                <div className="font-bold">{hhmm(e.endMinuteOfDay)}まで</div>
                <div>
                  {durationLabel(e.durationMinutes)} {yen(e.quote.price)}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {selection && end && quote && (
        <Confirm
          bookingCode={bookingCode}
          day={day}
          selection={selection}
          end={end}
          quote={quote}
          currentTotal={currentTotal}
          requestKey={requestKey}
        />
      )}
    </div>
  )
}

function Confirm({
  bookingCode,
  day,
  selection,
  end,
  quote,
  currentTotal,
  requestKey,
}: {
  bookingCode: string
  day: DayAvailability
  selection: Selection
  end: EndOption
  quote: ChangeQuoteView
  currentTotal: number
  requestKey: string
}) {
  const [state, action, saving] = useActionState(changeBookingAction, { error: null })
  const { settlement } = quote
  const blocked = settlement.kind === 'increase_not_allowed'
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-line bg-white p-4 text-sm">
      <dl className="space-y-1">
        <div className="flex justify-between gap-3">
          <dt className="text-sub">変更後</dt>
          <dd className="text-right font-bold">
            {dateLabel(day.date)} {hhmm(selection.startMinute)}-{hhmm(end.endMinuteOfDay)} /{' '}
            {quote.after.laneLabel} / {yen(quote.after.total)}
          </dd>
        </div>
        {quote.after.discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-sub">クーポン割引</dt>
            <dd>−{yen(quote.after.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-2 font-bold">
          <dt>差額</dt>
          <dd className={blocked ? 'text-alert' : 'text-brand-dark'}>
            {settlement.kind === 'none'
              ? '差額なし'
              : settlement.kind === 'refund'
                ? `−${yen(settlement.amount)}（返金）`
                : `+${yen(settlement.amount)}`}
          </dd>
        </div>
      </dl>
      {settlement.kind === 'refund' && (
        <p className="text-xs text-sub">
          差額 {yen(settlement.amount)}{' '}
          はお支払いに使われた決済方法へ返金されます（反映まで数日）。現在のお支払い額
          {yen(currentTotal)}
        </p>
      )}
      {blocked ? (
        <p className="rounded-lg bg-alert-pale p-3 text-alert">
          変更後の料金が現在のご予約より高くなるため、この画面では変更できません。無料キャンセル期間中にキャンセルのうえ新しくご予約いただくか、店舗までお問い合わせください
        </p>
      ) : (
        <form action={action} className="space-y-2">
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <input type="hidden" name="date" value={day.date} />
          <input type="hidden" name="laneKey" value={selection.lane.key} />
          <input type="hidden" name="start" value={selection.start} />
          <input type="hidden" name="end" value={end.end} />
          <input type="hidden" name="requestKey" value={requestKey} />
          <FormError message={state.error} />
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60"
          >
            {saving ? '変更しています…' : 'この内容に変更する'}
          </button>
        </form>
      )}
    </section>
  )
}
