import type { PaymentLinkView } from '@jancube/application'
import { minuteOfBusinessDay, utcToLocal } from '@jancube/domain'
import type { Metadata } from 'next'
import { HoldCountdown } from '@/components/HoldCountdown'
import { dateLabel, hhmm, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { PayButton } from './PayButton'

export const dynamic = 'force-dynamic'

// The token is the credential for paying: keep the page out of search engines and referrers.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * C-18 決済リンク着地(代理予約): the booking taken by phone, then the normal payment flow (C-09/C-10).
 * Customers who are not signed in verify their phone number first (C-05〜C-07).
 */
export default async function PaymentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let view: PaymentLinkView
  try {
    view = await withContainer((c) => c.getPaymentLink(token))
  } catch (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <p className="rounded-xl border border-alert/40 bg-alert-pale p-4 font-bold text-alert">
          {toUserMessage(error)}
        </p>
      </main>
    )
  }
  const b = view.booking
  const start = minuteOfBusinessDay(b.businessDate, b.start, b.timezone)
  const end = minuteOfBusinessDay(b.businessDate, b.end, b.timezone)

  if (view.state === 'paid') {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <section className="rounded-xl border border-brand bg-brand-pale p-4">
          <h1 className="text-lg font-bold">✅ お支払いは完了しています</h1>
          <p className="mt-1 text-sm text-sub">予約番号 {b.bookingCode}</p>
        </section>
        <p className="text-sm text-sub">お部屋番号と入室コードはご利用日の前日にお知らせします</p>
      </main>
    )
  }

  const expires = utcToLocal(view.expiresAt, b.timezone)
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <section className="rounded-xl border border-gold bg-gold-pale p-4">
        <h1 className="font-bold">📞 お電話でお取りした予約のお支払い</h1>
        <p className="mt-1 text-sm text-sub">
          お支払い期限 {dateLabel(expires.date)} {hhmm(expires.minuteOfDay)}
        </p>
      </section>
      <section className="rounded-xl border border-line bg-white p-4 text-sm">
        <dl className="divide-y divide-line">
          <Row label="店舗" value={`${b.storeCode} ${b.storeName}`} />
          <Row label="日時" value={`${dateLabel(b.businessDate)} ${hhmm(start)}-${hhmm(end)}`} />
          <Row
            label="部屋タイプ"
            value={`${b.roomGroupName}${b.requestedRoomName ? ` ${b.requestedRoomName}` : ''}`}
          />
          <Row label="人数" value={`${b.guestCount}名`} />
          {view.issuedByName && <Row label="受付担当" value={view.issuedByName} />}
        </dl>
      </section>
      <section className="flex items-baseline justify-between rounded-xl border border-line bg-white p-4">
        <span className="font-bold">お支払い金額(税込)</span>
        <span className="text-2xl font-bold text-brand-dark">{yen(b.total)}</span>
      </section>
      <PayButton token={token} />
      <p className="text-xs text-sub">
        未会員の方・ログインしていない方は、電話番号のSMS認証のうえお支払いに進みます。
        クーポンはお支払い画面で適用できます
      </p>
      <HoldCountdown expiresAt={view.expiresAt.toISOString()} />
      <p className="rounded-xl bg-alert-pale p-3 text-sm text-alert">
        期限を過ぎるとこのリンクは無効になります。お手数ですが店舗へご連絡ください
      </p>
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
