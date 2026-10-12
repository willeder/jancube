import { minuteOfBusinessDay } from '@jancube/domain'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ErrorPanel } from '@/components/StoreBar'
import { dateLabel, hhmm, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readSessionMemberId } from '@/server/session'
import { AutoRefresh } from './AutoRefresh'

export const dynamic = 'force-dynamic'

const METHOD_LABEL = { card: 'カード決済済', paypay: 'PayPay決済済' } as const

/** C-11 予約完了. Room number and entry code are sent the day before (not shown here). */
export default async function CompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id: checkoutId } = await searchParams
  const memberId = await readSessionMemberId()
  if (!memberId) redirect('/booking/auth')

  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(await readHoldKey(), memberId, checkoutId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { booking, payment, sync } = view

  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    if (sync === 'refunded') {
      return (
        <ErrorPanel
          message="お支払いの完了前に仮押さえの期限が切れ、お部屋が埋まってしまいました。お支払いは全額返金します。お手数ですが、もう一度ご予約ください"
          backHref={`/booking/${booking.storeCode}/date`}
        />
      )
    }
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <p className="rounded-xl bg-brand-pale p-4 text-brand-dark">お支払いを確認しています…</p>
        <p className="text-xs text-sub">このままお待ちください。画面は自動で更新されます</p>
        <AutoRefresh seconds={3} />
      </main>
    )
  }

  const start = minuteOfBusinessDay(booking.businessDate, booking.start, booking.timezone)
  const end = minuteOfBusinessDay(booking.businessDate, booking.end, booking.timezone)
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <section className="rounded-xl border border-brand bg-brand-pale p-4">
        <h1 className="text-lg font-bold">✅ ご予約が完了しました</h1>
        <p className="mt-1 text-sm text-sub">予約番号 {booking.bookingCode}</p>
      </section>

      <section className="rounded-xl border border-brand bg-brand-pale p-4 text-sm">
        <h2 className="font-bold text-brand-dark">🔑 お部屋番号と入室コードのお知らせ</h2>
        <p className="mt-1">ご利用日の前日にお知らせします</p>
        <ul className="mt-1 list-inside list-disc text-sub">
          <li>お部屋番号とお部屋タイプ</li>
          <li>店舗入口の入室コード</li>
          <li>入室のご案内</li>
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-white p-4 text-sm">
        <dl className="divide-y divide-line">
          <Row label="店舗" value={`${booking.storeCode} ${booking.storeName}`} />
          <Row
            label="日時"
            value={`${dateLabel(booking.businessDate)} ${hhmm(start)}-${hhmm(end)}`}
          />
          <Row
            label="お部屋"
            value={
              booking.requestedRoomName
                ? `${booking.roomGroupName} / ${booking.requestedRoomName}`
                : `${booking.roomGroupName}（部屋番号は前日にお知らせ）`
            }
          />
          <Row label="ご利用人数" value={`${booking.guestCount}名`} />
          <Row
            label="お支払い"
            value={
              payment
                ? `${yen(payment.amount)}（税込） ${METHOD_LABEL[payment.method]}`
                : `${yen(booking.total)}（クーポン適用）`
            }
          />
        </dl>
      </section>

      <Link
        href="/"
        className="block w-full rounded-xl border border-brand py-3 text-center font-bold text-brand"
      >
        トップへ戻る
      </Link>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="shrink-0 text-sub">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  )
}

function load(holdKey: string | null, memberId: number, checkoutId: string | undefined) {
  return withContainer(async (c) => {
    // Returning from the payment page: confirm right away instead of waiting for the webhook.
    const sync = checkoutId
      ? await c.syncCheckout(checkoutId).catch(() => 'pending' as const)
      : null
    const result = await c.getCompletedBooking(holdKey, memberId)
    return { ...result, sync }
  })
}
