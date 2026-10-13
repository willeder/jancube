import { can } from '@jancube/domain'
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PaymentBadge,
  shortDateTime,
} from '@/components/admin/booking-format'
import {
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Stat,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { yen } from '@/lib/format'
import { retryRefundAction } from '@/server/admin-booking-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

type Search = {
  from?: string
  to?: string
  kind?: string
  method?: string
  status?: string
  refund?: string
  error?: string
}

/** A-26 決済・返金履歴 (receipts and CSV are separate features). */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff('payments.view')
  const q = await searchParams
  let data: Awaited<ReturnType<typeof load>>
  try {
    data = await load(staff, q)
  } catch (e) {
    return (
      <>
        <PageHeader title="決済・返金履歴" />
        <Notice tone="red">{toUserMessage(e)}</Notice>
      </>
    )
  }
  const self = `/admin/payments?${new URLSearchParams(
    Object.entries({
      from: q.from,
      to: q.to,
      kind: q.kind,
      method: q.method,
      status: q.status,
    }).filter(([, v]) => v) as [string, string][],
  )}`
  const canRefund = can(staff.access, 'bookings.cancel')

  return (
    <>
      <PageHeader
        title="決済・返金履歴"
        description="決済と返金の一覧。失敗した返金を再実行できます"
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={yen(data.totals.paid)} label="当月 決済合計" />
        <Stat value={yen(data.totals.refunded)} label="当月 返金合計" />
        <Stat value={yen(data.totals.paid - data.totals.refunded)} label="当月 純売上" />
        <Stat value={`${data.totals.pending}件`} label="当月 未決済(手続き中)" />
      </div>
      {q.refund === 'ok' && (
        <div className="mb-3">
          <Notice tone="green">返金を実行しました</Notice>
        </div>
      )}
      {q.refund === 'failed' && (
        <div className="mb-3">
          <Notice tone="red">返金に再度失敗しました。アラート一覧(A-25)に登録しました</Notice>
        </div>
      )}
      {q.error && (
        <div className="mb-3">
          <Notice tone="red">{q.error}</Notice>
        </div>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="期間(から)">
          <input type="date" name="from" defaultValue={data.from} className={inputClass} />
        </Field>
        <Field label="期間(まで)">
          <input type="date" name="to" defaultValue={data.to} className={inputClass} />
        </Field>
        <Field label="種別">
          <select name="kind" defaultValue={q.kind ?? ''} className={inputClass}>
            <option value="">すべて</option>
            <option value="payment">決済</option>
            <option value="refund">返金</option>
          </select>
        </Field>
        <Field label="方法">
          <select name="method" defaultValue={q.method ?? ''} className={inputClass}>
            <option value="">すべて</option>
            <option value="card">カード</option>
            <option value="paypay">PayPay</option>
          </select>
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={q.status ?? ''} className={inputClass}>
            <option value="">すべて</option>
            {Object.entries(PAYMENT_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className={buttonClass.primary}>
          検索
        </button>
      </form>

      <Table
        head={['日時', '種別', '予約番号', '店舗', 'お客様', '方法', '金額', '状態', '操作']}
        rows={data.rows.map((r) => [
          shortDateTime(r.at),
          r.kind === 'payment' ? '決済' : '返金',
          <TextLink key="b" href={`/admin/bookings/${r.bookingCode}`}>
            {r.bookingCode}
          </TextLink>,
          r.storeCode,
          r.customerName ?? '—',
          PAYMENT_METHOD[r.method] ?? r.method,
          r.kind === 'refund' ? `-${yen(r.amount)}` : yen(r.amount),
          <span key="s" title={r.failureMessage ?? undefined}>
            <PaymentBadge status={r.status} />
            {r.failureMessage && r.status === 'failed' && (
              <span className="block max-w-48 truncate text-xs text-alert">{r.failureMessage}</span>
            )}
          </span>,
          r.kind === 'refund' && r.status === 'failed' && canRefund ? (
            <form key="a" action={retryRefundAction}>
              <input type="hidden" name="refundId" value={r.id} />
              <input type="hidden" name="back" value={self} />
              <button type="submit" className={buttonClass.primary}>
                返金を再実行
              </button>
            </form>
          ) : null,
        ])}
        empty="該当する決済・返金はありません"
      />
      <p className="mt-2 text-xs text-sub">
        再実行は同じ冪等キーで決済事業者へ依頼するため、二重に返金されることはありません
      </p>
    </>
  )
}

async function load(staff: Awaited<ReturnType<typeof requireStaff>>, q: Search) {
  const storeId = await selectedStoreId(staff, 'payments.view')
  return withContainer((c) =>
    c.listPaymentHistory(staff.access, storeId, {
      from: q.from,
      to: q.to,
      kind: q.kind,
      method: q.method,
      status: q.status,
    }),
  )
}
