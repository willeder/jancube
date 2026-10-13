import type { CancellationQuote } from '@jancube/application'
import Link from 'next/link'
import { bookingWhen, phoneLabel } from '@/components/admin/booking-format'
import { buttonClass, Card, Notice, PageHeader, Table } from '@/components/admin/ui'
import { yen } from '@/lib/format'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { CancelForm } from './CancelForm'

export const dynamic = 'force-dynamic'

/** A-08 管理側キャンセル・返金 */
export default async function StaffCancelPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff('bookings.cancel')
  const code = decodeURIComponent((await params).code)
  const back = `/admin/bookings/${code}`
  let quote: CancellationQuote
  let customer: { name: string | null; phone: string | null }
  try {
    ;[quote, customer] = await withContainer(async (c) => {
      const q = await c.staffQuoteCancellation(staff.access, code)
      const detail = await c.getBookingDetail(staff.access, code)
      return [q, { name: detail.booking.customerName, phone: detail.booking.phone }] as const
    })
  } catch (error) {
    return (
      <>
        <PageHeader title={`キャンセル・返金 — ${code}`} />
        <Notice tone="red">{toUserMessage(error)}</Notice>
        <Link href={back} className={`${buttonClass.secondary} mt-3`}>
          予約詳細へ戻る
        </Link>
      </>
    )
  }
  const b = quote.booking

  return (
    <>
      <PageHeader
        title={`キャンセル・返金 — ${code}`}
        description="キャンセル料率は自動計算されます。手動で上書きする場合は理由が必須です"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="対象予約">
            <dl className="divide-y divide-line text-sm">
              <Row
                label="お客様"
                value={`${customer.name ?? '—'} / ${phoneLabel(customer.phone)}`}
              />
              <Row label="日時" value={bookingWhen(b)} />
              <Row
                label="店舗・部屋"
                value={`${b.storeCode} ${b.storeName} / ${b.roomGroupName}${
                  b.requestedRoomName ? ` ${b.requestedRoomName}` : ''
                }`}
              />
              <Row label="お支払い済" value={yen(quote.paid)} />
            </dl>
          </Card>
          <Card title="キャンセル料(FR-2.9)">
            <Table
              head={['時期', '料率', '適用']}
              rows={[
                ['開始24時間前まで', '0%', quote.feeRate === 0 ? '← 該当(自動)' : ''],
                ['開始24時間前以降', '50%', quote.feeRate === 50 ? '← 該当(自動)' : ''],
                ['開始以降', '100%', quote.feeRate === 100 ? '← 該当(自動)' : ''],
              ]}
            />
          </Card>
        </div>
        <CancelForm
          bookingCode={code}
          paid={quote.paid}
          automaticRate={quote.feeRate}
          automaticFee={quote.fee}
          backHref={back}
        />
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sub">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  )
}
