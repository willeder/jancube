import Link from 'next/link'
import { buttonOutline, buttonPrimary, Card, Row } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { bookingWhen } from '@/lib/booking-time'
import { yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'

export const dynamic = 'force-dynamic'

/** C-15 キャンセル完了 */
export default async function CancelDonePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const memberId = await requireMemberPage(bookingPath(code, '/cancel/done'))
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(code, memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/mypage" />
  }
  const b = view.booking
  const c = b.cancellation
  if (b.status !== 'canceled' || !c) {
    return (
      <ErrorPanel message="このご予約はキャンセルされていません" backHref={bookingPath(code)} />
    )
  }
  const failed = b.refunds.some((r) => r.status === 'failed')

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <section className="rounded-xl border border-brand bg-brand-pale p-4">
        <h1 className="text-lg font-bold">ご予約をキャンセルしました</h1>
        <p className="mt-1 text-sm text-sub">予約番号 {b.bookingCode}</p>
      </section>
      <Card>
        <p className="font-bold">{bookingWhen({ ...b, timezone: b.store.timezone })}</p>
        <p className="mt-1 text-sub">
          {b.store.code} {b.store.name} / {b.roomGroupName}
        </p>
        <dl className="mt-2 border-t border-line pt-1">
          <Row label={`キャンセル料（${c.feeRate}%）`} value={yen(c.fee)} />
          <Row label="返金額" value={yen(c.refund)} accent="brand" />
        </dl>
        {c.refund > 0 && (
          <p className="mt-2 text-xs text-sub">
            {failed
              ? '返金処理に時間がかかっています。店舗で確認のうえ対応しますので、しばらくお待ちください'
              : 'お支払いに使われた決済方法へ返金します（反映まで数日かかる場合があります）'}
          </p>
        )}
      </Card>
      {view.receipt.ok && (
        <Link href={bookingPath(b.bookingCode, '/receipt')} className={buttonOutline}>
          キャンセル料の領収書を発行する
        </Link>
      )}
      <Link href="/mypage" className={buttonPrimary}>
        マイページへ戻る
      </Link>
    </main>
  )
}

function load(code: string, memberId: number) {
  return withContainer((c) => c.getMyBookingDetail(code, memberId))
}
