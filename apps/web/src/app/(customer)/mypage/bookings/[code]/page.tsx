import { minuteOfBusinessDay } from '@jancube/domain'
import Link from 'next/link'
import { BookingShare } from '@/components/BookingShare'
import {
  type BadgeKind,
  buttonDanger,
  buttonOutline,
  Card,
  Notice,
  PageHeader,
  Row,
  StatusBadge,
} from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { bookingTimes } from '@/lib/booking-time'
import { durationLabel, fullDateLabel, hhmm, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'

export const dynamic = 'force-dynamic'

const METHOD_LABEL: Record<string, string> = {
  card: 'クレジットカード',
  paypay: 'PayPay',
  other: 'その他',
}

/** C-13 予約詳細 */
export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ changed?: string }>
}) {
  const { code } = await params
  const { changed } = await searchParams
  const memberId = await requireMemberPage(bookingPath(code))
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(code, memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/mypage" />
  }
  const { booking: b, room, entry } = view
  const tz = b.store.timezone
  const badge: BadgeKind =
    b.status === 'canceled'
      ? 'canceled'
      : !view.upcoming
        ? 'used'
        : b.requestedRoom || b.assignedRoom?.status === 'final'
          ? 'confirmed'
          : 'provisional'
  const at = (instant: Date) => hhmm(minuteOfBusinessDay(b.businessDate, instant, tz))
  const refundedOk = b.refunds.filter((r) => r.status !== 'failed')

  return (
    <>
      <PageHeader backHref="/mypage" title="予約詳細" badge={<StatusBadge kind={badge} />} />
      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        <p className="text-xs text-sub">予約番号 {b.bookingCode}</p>
        {changed === '1' && <Notice tone="success">ご予約内容を変更しました</Notice>}
        {changed === 'refund_pending' && (
          <Notice tone="warn">
            ご予約内容を変更しました。差額の返金処理に時間がかかっています。店舗で確認のうえ対応します
          </Notice>
        )}

        {b.status !== 'canceled' && (
          <Card className="text-center">
            <h2 className="text-left font-bold text-brand-dark">お部屋のご案内</h2>
            {room ? (
              <>
                <p className="mt-3 text-5xl font-bold tabular-nums">{room.name}</p>
                <p className="mt-2 text-sub">{b.roomGroupName}</p>
                {b.roomGuide?.location && <p className="mt-2 text-sm">{b.roomGuide.location}</p>}
                {b.roomGuide?.photoUrl && (
                  // biome-ignore lint/performance/noImgElement: room-master URLs are not a fixed image-host allowlist
                  <img
                    src={b.roomGuide.photoUrl}
                    alt={`${room.name}の扉`}
                    width={640}
                    height={360}
                    referrerPolicy="no-referrer"
                    className="mt-3 aspect-video w-full rounded-lg object-cover"
                  />
                )}
              </>
            ) : (
              <p className="mt-3 text-sub">
                {b.roomGroupName}・お部屋番号はご利用日の前日にお知らせします
              </p>
            )}
          </Card>
        )}

        {view.upcoming && (
          <Card className="bg-paper">
            <h2 className="font-bold">店舗入口の入室コード</h2>
            {entry ? (
              <>
                <p className="mt-2 text-center text-4xl font-bold tracking-widest tabular-nums">
                  {entry.code}
                </p>
                <p className="mt-2 text-xs text-sub">
                  ご利用日 {at(entry.validFrom)} 〜 {at(entry.validTo)} の間だけ有効です
                </p>
              </>
            ) : (
              <p className="mt-1 text-sub">
                {view.entryDisclosed
                  ? '入室コードを準備しています。表示されない場合は店舗までお問い合わせください'
                  : 'ご利用日の前日の通知以降に、この欄に表示されます'}
              </p>
            )}
            <p className="mt-2 text-xs text-sub">
              ※ お部屋の扉には鍵はありません。入口のみ解錠してお入りください
            </p>
          </Card>
        )}

        <Card>
          <dl className="divide-y divide-line">
            <Row label="店舗" value={`${b.store.code} ${b.store.name}`} />
            <Row
              label="日時"
              value={`${fullDateLabel(b.businessDate)} ${bookingTimes({ ...b, timezone: tz })}`}
            />
            <Row
              label="部屋"
              value={
                room
                  ? `${b.roomGroupName} ${room.name}${b.assignedRoom?.status === 'final' || b.requestedRoom ? '（確定）' : ''}`
                  : b.roomGroupName
              }
            />
            <Row label="人数" value={`${b.guestCount}名`} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-bold">料金内訳</h2>
          <dl className="mt-1">
            <Row
              label={`${durationLabel(b.price.durationMinutes)}${b.price.packageDiscount > 0 ? ' パック料金' : ''}`}
              value={yen(b.price.subtotal)}
            />
            {b.coupon && (
              <Row
                label={`クーポン割引（${b.coupon.name}）`}
                value={`−${yen(b.price.discount)}`}
                accent="alert"
              />
            )}
            <div className="flex justify-between border-t border-line pt-2 font-bold">
              <dt>お支払い合計（税込）</dt>
              <dd className="text-lg text-brand-dark">{yen(b.price.total)}</dd>
            </div>
            {b.payments.map((p) => (
              <Row
                key={p.id}
                label="お支払い方法"
                value={`${METHOD_LABEL[p.method] ?? p.method} ${yen(p.amount)}`}
              />
            ))}
            {refundedOk.map((r, i) => (
              <Row
                // biome-ignore lint/suspicious/noArrayIndexKey: refunds have no other stable key here
                key={i}
                label={r.status === 'succeeded' ? '返金済' : '返金手続き中'}
                value={yen(r.amount)}
              />
            ))}
          </dl>
        </Card>

        {b.cancellation && (
          <Card>
            <h2 className="font-bold">キャンセル</h2>
            <dl className="mt-1">
              <Row
                label="キャンセル料"
                value={`${yen(b.cancellation.fee)}（${b.cancellation.feeRate}%）`}
              />
              <Row label="返金額" value={yen(b.cancellation.refund)} />
            </dl>
          </Card>
        )}

        {view.upcoming && (b.store.entryGuideText || b.store.accessText) && (
          <section className="rounded-xl border border-brand bg-brand-pale p-4 text-sm">
            <h2 className="font-bold text-brand-dark">🚪 入室のご案内</h2>
            {b.store.entryGuideText && (
              <p className="mt-1 whitespace-pre-line">{b.store.entryGuideText}</p>
            )}
            {b.store.accessText && <p className="mt-1 text-sub">{b.store.accessText}</p>}
            {b.store.mapUrl && (
              <a
                href={b.store.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-bold text-brand-dark underline"
              >
                地図を開く
              </a>
            )}
          </section>
        )}

        {view.upcoming && (
          <Card>
            <h2 className="font-bold">お部屋が合わないときは</h2>
            <p className="mt-1 text-sub">
              すでに他のお客様がいらっしゃる場合は、お入りにならずに店舗までご連絡ください
            </p>
            {b.store.phone && <p className="mt-1">TEL {b.store.phone}</p>}
          </Card>
        )}

        <div className="space-y-3">
          {view.shareText && <BookingShare text={view.shareText} />}
          {view.canChange && (
            <Link href={bookingPath(b.bookingCode, '/change')} className={buttonOutline}>
              予約を変更する
            </Link>
          )}
          {view.upcoming && !view.canChange && (
            <p className="text-xs text-sub">
              ご利用開始24時間前以降（キャンセル料が発生する期間）は、日程変更はできません
            </p>
          )}
          {(view.receipt.ok || view.upcoming) && (
            <Link href={bookingPath(b.bookingCode, '/receipt')} className={buttonOutline}>
              領収書を表示
            </Link>
          )}
          {view.canCancel && (
            <Link href={bookingPath(b.bookingCode, '/cancel')} className={buttonDanger}>
              予約をキャンセルする
            </Link>
          )}
        </div>
      </main>
    </>
  )
}

function load(code: string, memberId: number) {
  return withContainer((c) => c.getMyBookingDetail(code, memberId))
}
