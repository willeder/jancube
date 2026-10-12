import Link from 'next/link'
import { buttonOutline, Card, PageHeader, Row } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { bookingWhen } from '@/lib/booking-time'
import { yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'
import { CancelForm } from './CancelForm'

export const dynamic = 'force-dynamic'

const TIERS = [
  { label: '24時間より前', rate: 0 },
  { label: '24時間以内', rate: 50 },
  { label: '開始時刻以降', rate: 100 },
] as const

/** C-15 キャンセル確認: the fee is decided by the time left until the start (FR-2.9). */
export default async function CancelPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const back = bookingPath(code)
  const memberId = await requireMemberPage(bookingPath(code, '/cancel'))
  let quote: Awaited<ReturnType<typeof load>>
  try {
    quote = await load(code, memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref={back} />
  }
  const b = quote.booking

  return (
    <>
      <PageHeader backHref={back} title="予約のキャンセル" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        <p className="text-sm text-sub">キャンセル料は開始までの残り時間で決まります</p>
        <Card>
          <p className="font-bold">{bookingWhen(b)}</p>
          <p className="mt-1 text-sub">
            {b.storeCode} {b.storeName} / {b.roomGroupName} / お支払い済 {yen(quote.paid)}
          </p>
        </Card>

        <Card>
          <table className="w-full text-left">
            <thead>
              <tr className="text-sub">
                <th className="py-1 font-normal">キャンセル時期</th>
                <th className="py-1 text-right font-normal">料率</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr
                  key={t.rate}
                  className={`border-t border-line ${t.rate === quote.feeRate ? 'font-bold text-brand-dark' : ''}`}
                >
                  <td className="py-1.5">
                    {t.rate === quote.feeRate && '▶ '}
                    {t.label}
                  </td>
                  <td className="py-1.5 text-right">{t.rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <dl>
            <Row
              label={`キャンセル料（${quote.feeRate}%）`}
              value={yen(quote.fee)}
              accent="alert"
            />
            <Row label="返金額" value={yen(quote.refund)} accent="brand" />
          </dl>
          <p className="mt-2 text-xs text-sub">
            返金はお支払いに使われた決済方法へ行います（反映まで数日かかる場合があります）。
            {quote.feeRate === 0 && b.discount > 0 && 'ご利用のクーポンはお戻しします。'}
          </p>
        </Card>

        {quote.fee > 0 && (
          <p className="rounded-lg bg-gold-pale p-3 text-xs">
            🧾 キャンセル料の領収書は、キャンセル確定後に予約詳細から発行できます
          </p>
        )}

        <CancelForm bookingCode={b.bookingCode} />
        <Link href={back} className={buttonOutline}>
          戻る
        </Link>
      </main>
    </>
  )
}

function load(code: string, memberId: number) {
  return withContainer((c) => c.quoteMyCancellation(code, memberId))
}
