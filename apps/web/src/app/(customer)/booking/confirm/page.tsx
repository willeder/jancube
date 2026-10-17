import type { BookingSummary } from '@jancube/application'
import { minuteOfBusinessDay } from '@jancube/domain'
import { BookingFlow } from '@/components/BookingFlow'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel } from '@/components/StoreBar'
import { dateLabel, durationLabel, hhmm, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { ChangeSelectionButton, ConfirmForm } from './ConfirmForm'

export const dynamic = 'force-dynamic'

/** C-04 予約内容確認 (hold is active, countdown running) */
export default async function ConfirmPage() {
  const key = await readHoldKey()
  let hold: BookingSummary
  try {
    hold = await withContainer((c) => c.getActiveHold(key))
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }

  const start = minuteOfBusinessDay(hold.businessDate, hold.start, hold.timezone)
  const end = minuteOfBusinessDay(hold.businessDate, hold.end, hold.timezone)
  const discount = hold.regularPrice - hold.subtotal

  return (
    <BookingFlow
      step={4}
      storeName={hold.storeName}
      backHref={`/booking/${hold.storeCode}/slots?date=${hold.businessDate}`}
    >
      <div>
        <h1 className="text-base font-bold">予約内容の確認</h1>
        <p className="text-sm text-sub">各項目の「変更」から日時・お部屋を修正できます</p>
      </div>

      <section className="booking-card text-sm">
        <dl className="divide-y divide-line">
          {[
            ['店舗', `${hold.storeCode} ${hold.storeName}`],
            ['日付', dateLabel(hold.businessDate)],
            [
              '部屋タイプ',
              hold.requestedRoomName
                ? `${hold.roomGroupName} / ${hold.requestedRoomName}`
                : `${hold.roomGroupName}（部屋番号は前日20時に確定。当日予約は決済後にお知らせ）`,
            ],
            ['開始', hhmm(start)],
            ['終了', `${hhmm(end)}（${durationLabel(end - start)}）`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <dt className="text-[11px] text-sub">{label}</dt>
                <dd className="mt-0.5 text-[13px] font-bold">{value}</dd>
              </div>
              <ChangeSelectionButton
                storeCode={hold.storeCode}
                date={hold.businessDate}
                compact
                target={label === '店舗' ? 'store' : label === '日付' ? 'date' : 'slots'}
              />
            </div>
          ))}
        </dl>
      </section>

      <ConfirmForm capacity={hold.capacity} guestCount={hold.guestCount}>
        <section className="booking-card text-sm">
          <dl className="space-y-1.5">
            <Row label="通常料金" value={yen(hold.regularPrice)} />
            <div className="flex justify-between border-t border-line pt-2 font-bold">
              <dt>税込合計</dt>
              <dd className="text-lg text-brand-dark">{yen(hold.subtotal)}</dd>
            </div>
            {discount > 0 && <Row label="パック割引" value={`−${yen(discount)}`} accent />}
          </dl>
          <p className="mt-2 text-xs text-sub">
            初回クーポン等の割引は、認証後のお支払い画面で適用されます
          </p>
        </section>

        <HoldCountdown
          expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()}
          storeCode={hold.storeCode}
        />

        <p className="text-xs text-sub">
          キャンセル: 24時間前まで無料 / 24時間以内50% /
          開始以降100%。キャンセル料が発生する期間は日程変更もできません
        </p>
      </ConfirmForm>
    </BookingFlow>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-sub">{label}</dt>
      <dd className={`text-right ${accent ? 'text-alert' : ''}`}>{value}</dd>
    </div>
  )
}
