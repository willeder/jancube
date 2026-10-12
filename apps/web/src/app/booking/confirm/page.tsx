import type { BookingSummary } from '@jancube/application'
import { minuteOfBusinessDay } from '@jancube/domain'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel, StoreBar } from '@/components/StoreBar'
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
    <>
      <StoreBar
        storeName={hold.storeName}
        backHref={`/booking/${hold.storeCode}/slots?date=${hold.businessDate}`}
      />
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-bold">ご予約内容の確認</h1>
          <p className="mt-1 text-sm text-sub">
            内容をご確認のうえ、お客様情報の入力へお進みください
          </p>
        </div>

        <section className="rounded-xl border border-line bg-white p-4 text-sm">
          <div className="mb-2 font-bold">
            {hold.storeCode} {hold.storeName}
          </div>
          <dl className="space-y-1.5">
            <Row label="日付" value={dateLabel(hold.businessDate)} />
            <Row
              label="お部屋"
              value={
                hold.requestedRoomName
                  ? `${hold.roomGroupName} / ${hold.requestedRoomName}`
                  : `${hold.roomGroupName}（お部屋番号はご利用前日にお知らせします）`
              }
            />
            <Row label="開始" value={hhmm(start)} />
            <Row label="終了" value={`${hhmm(end)}（${durationLabel(end - start)}）`} />
          </dl>
        </section>

        <section className="rounded-xl border border-line bg-white p-4 text-sm">
          <dl className="space-y-1.5">
            <Row label="通常料金" value={yen(hold.regularPrice)} />
            {discount > 0 && <Row label="パック割引" value={`−${yen(discount)}`} accent />}
            <div className="flex justify-between border-t border-line pt-2 font-bold">
              <dt>税込合計</dt>
              <dd className="text-lg text-brand-dark">{yen(hold.subtotal)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-sub">
            初回クーポン等の割引は、認証後のお支払い画面で適用されます
          </p>
        </section>

        <HoldCountdown expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()} />

        <p className="text-xs text-sub">
          キャンセル: 24時間前まで無料 / 24時間以内50% /
          開始以降100%。キャンセル料が発生する期間は日程変更もできません
        </p>

        <ConfirmForm capacity={hold.capacity} guestCount={hold.guestCount} />
        <ChangeSelectionButton storeCode={hold.storeCode} date={hold.businessDate} />
      </main>
    </>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-sub">{label}</dt>
      <dd className={`text-right ${accent ? 'text-brand' : ''}`}>{value}</dd>
    </div>
  )
}
