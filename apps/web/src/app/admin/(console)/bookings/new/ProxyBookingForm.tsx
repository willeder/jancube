'use client'

import type { AvailabilityLane, DayAvailability, EndOption } from '@jancube/application'
import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import { buttonClass, Field, inputClass, Notice } from '@/components/admin/ui'
import { dateLabel, durationLabel, hhmm, yen } from '@/lib/format'
import {
  adminEndOptionsAction,
  createProxyBookingAction,
  lookupMemberAction,
  type ProxyBookingState,
} from '@/server/admin-booking-actions'

type Selection = { lane: AvailabilityLane; start: string; startMinute: number }
type Member = { memberCode: string; name: string; canBook: boolean } | null

/** A-06: ① customer ② time (same grid rules as C-03) ③ payment link. */
export function ProxyBookingForm({ day }: { day: DayAvailability }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [ends, setEnds] = useState<EndOption[]>([])
  const [end, setEnd] = useState<EndOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [phone, setPhone] = useState('')
  const [member, setMember] = useState<Member | undefined>(undefined)
  const [state, action, submitting] = useActionState<ProxyBookingState, FormData>(
    createProxyBookingAction,
    { error: null },
  )

  function pickStart(lane: AvailabilityLane, start: string, startMinute: number) {
    setSelection({ lane, start, startMinute })
    setEnd(null)
    setEnds([])
    setError(null)
    startTransition(async () => {
      const result = await adminEndOptionsAction({
        storeCode: day.store.code,
        date: day.date,
        laneKey: lane.key,
        start,
      })
      if (!result.ok) return setError(result.error)
      if (result.data.length === 0) setError('この時間からはご予約できません')
      setEnds(result.data)
    })
  }

  function lookup() {
    startTransition(async () => {
      const result = await lookupMemberAction(phone)
      if (!result.ok) {
        setMember(undefined)
        return setError(result.error)
      }
      setError(null)
      setMember(result.data)
    })
  }

  if (state.result) return <IssuedLink result={state.result} />

  const inRange = (lane: AvailabilityLane, minute: number) =>
    selection?.lane.key === lane.key &&
    minute >= selection.startMinute &&
    minute < (end?.endMinuteOfDay ?? selection.startMinute + 30)

  return (
    <form action={action} className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_1.6fr]">
      <section className="space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">① お客様</h2>
        <Field label="電話番号" hint="会員登録済みの番号なら会員として予約します">
          <div className="flex gap-2">
            <input
              name="phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setMember(undefined)
              }}
              inputMode="tel"
              placeholder="090-1234-5678"
              required
              className={inputClass}
            />
            <button
              type="button"
              onClick={lookup}
              disabled={!phone}
              className={buttonClass.secondary}
            >
              検索
            </button>
          </div>
        </Field>
        {member && (
          <p
            className={`rounded-lg p-3 text-sm ${member.canBook ? 'bg-brand-pale' : 'bg-alert-pale text-alert'}`}
          >
            <span className="font-bold">
              {member.name}（{member.memberCode}）
            </span>
            {!member.canBook && ' — このアカウントでは予約できません'}
          </p>
        )}
        {member === null && (
          <p className="text-xs text-sub">
            会員登録がありません。お名前を入力してください（お客様は決済時にSMS認証・会員登録を行います）
          </p>
        )}
        {!member && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="姓">
              <input name="familyName" maxLength={100} className={inputClass} />
            </Field>
            <Field label="名">
              <input name="givenName" maxLength={100} className={inputClass} />
            </Field>
          </div>
        )}
        <Field label="人数" hint="部屋タイプの定員まで（3麻は3名まで）">
          <select name="guestCount" defaultValue="4" className={inputClass}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}名
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">
          ② ご予約内容 — {day.store.code} {day.store.name} / {dateLabel(day.date)}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-24 bg-white p-2 text-left text-sub">
                  部屋タイプ
                </th>
                {day.lanes[0]?.slots.map((s) => (
                  <th key={s.start} className="min-w-7 p-1 text-center font-normal text-sub">
                    {s.minuteOfDay % 60 === 0 ? hhmm(s.minuteOfDay) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {day.lanes.map((lane) => (
                <tr key={lane.key} className="border-t border-line">
                  <th className="sticky left-0 z-10 bg-white p-2 text-left font-normal">
                    <div className="font-bold">{lane.label}</div>
                    <div className="text-sub">
                      {lane.kind === 'group' ? `全${lane.roomCount}室` : lane.groupName}
                    </div>
                  </th>
                  {lane.slots.map((s) => (
                    <td key={s.start} className="p-0.5 text-center">
                      <button
                        type="button"
                        disabled={!s.available || pending}
                        onClick={() => {
                          if (
                            selection?.lane.key === lane.key &&
                            s.minuteOfDay >= selection.startMinute
                          ) {
                            const match = ends.find((e) => e.endMinuteOfDay === s.minuteOfDay + 30)
                            if (match) return setEnd(match)
                          }
                          pickStart(lane, s.start, s.minuteOfDay)
                        }}
                        aria-label={`${lane.label} ${hhmm(s.minuteOfDay)}`}
                        className={`h-7 w-6 rounded ${
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
        <p className="text-xs text-sub">開始の◯ → 終了の◯（または下の終了時刻）を選択</p>

        {selection && ends.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
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
              </button>
            ))}
          </div>
        )}

        {error && <Notice tone="red">{error}</Notice>}
        {selection && end && (
          <Notice tone="green">
            ✅ {selection.lane.label} {hhmm(selection.startMinute)}〜{hhmm(end.endMinuteOfDay)}（
            {durationLabel(end.durationMinutes)}）/ 料金 {yen(end.quote.price)}(税込)
          </Notice>
        )}
        <input type="hidden" name="storeCode" value={day.store.code} />
        <input type="hidden" name="date" value={day.date} />
        <input type="hidden" name="laneKey" value={selection?.lane.key ?? ''} />
        <input type="hidden" name="start" value={selection?.start ?? ''} />
        <input type="hidden" name="end" value={end?.end ?? ''} />
        {state.error && <Notice tone="red">{state.error}</Notice>}
        <button
          type="submit"
          disabled={!selection || !end || submitting || member?.canBook === false}
          className={`${buttonClass.primary} w-full py-3`}
        >
          {submitting ? '仮押さえしています…' : '仮押さえして決済リンクを発行'}
        </button>
      </section>
    </form>
  )
}

function IssuedLink({ result }: { result: NonNullable<ProxyBookingState['result']> }) {
  const [copied, setCopied] = useState(false)
  const expires = new Date(result.expiresAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <section className="space-y-3 rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">③ 決済リンク — {result.bookingCode}</h2>
      <p className="break-all rounded-lg border border-dashed border-gold bg-gold-pale p-3 font-mono text-sm">
        {result.paymentUrl}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass.primary}
          onClick={() => {
            navigator.clipboard.writeText(result.paymentUrl).then(() => setCopied(true))
          }}
        >
          {copied ? 'コピーしました' : 'リンクをコピー'}
        </button>
        <Link href={`/admin/bookings/${result.bookingCode}`} className={buttonClass.secondary}>
          予約詳細へ
        </Link>
        <Link href="/admin/bookings/new" className={buttonClass.secondary}>
          続けて作成
        </Link>
      </div>
      {result.sms === 'queued' ? (
        <Notice tone="green">
          お客様の携帯電話へSMSで送信します（送信結果は予約詳細の通知履歴で確認できます）
        </Notice>
      ) : (
        <Notice tone="red">
          SMSの通知テンプレートが無効のため送信していません。リンクをコピーしてお客様へお伝えください
        </Notice>
      )}
      <p className="text-xs text-sub">
        お支払い期限 {expires}
        （仮押さえ期限と同じ・CQ-23確認中）。期限切れで仮押さえは自動解放されます。
        LINEトークでの返信は、リンクをコピーしてLINE公式アカウントの管理画面から送ってください(F-LINE-06)。
        このURLはこの画面でのみ表示されます
      </p>
      {result.member && (
        <p className="text-xs text-sub">
          会員 {result.member.name}（{result.member.memberCode}）の予約として作成しました
        </p>
      )}
    </section>
  )
}
