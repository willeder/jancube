import { BOOKING_STATUSES } from '@jancube/application'
import Link from 'next/link'
import {
  BOOKING_SOURCE,
  BOOKING_STATUS,
  bookingWhen,
  phoneLabel,
  StatusBadge,
} from '@/components/admin/booking-format'
import {
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { yen } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

type Search = {
  from?: string
  to?: string
  status?: string
  code?: string
  name?: string
  phone?: string
  source?: string
  page?: string
}

/** A-04 予約一覧・検索 (CSV export is A-27, not here). */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff('bookings.view')
  const q = await searchParams
  let result: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    result = await load(staff, q)
  } catch (e) {
    error = toUserMessage(e)
  }
  const pageHref = (page: number) => {
    const params = new URLSearchParams(
      Object.entries({ ...q, page: String(page) }).filter(([, v]) => v) as [string, string][],
    )
    return `/admin/bookings?${params}`
  }

  return (
    <>
      <PageHeader
        title="予約一覧・検索"
        description="予約番号・氏名・電話番号・期間・状態・作成経路で検索します（店舗はサイドバーで切替）"
      />
      <form className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-4">
        <Field label="予約番号">
          <input name="code" defaultValue={q.code} placeholder="JC-2026-" className={inputClass} />
        </Field>
        <Field label="お客様名">
          <input name="name" defaultValue={q.name} placeholder="山田" className={inputClass} />
        </Field>
        <Field label="電話番号">
          <input
            name="phone"
            defaultValue={q.phone}
            placeholder="090-1234-5678"
            inputMode="tel"
            className={inputClass}
          />
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={q.status ?? ''} className={inputClass}>
            <option value="">すべて</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS[s]?.label ?? s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="利用日(から)">
          <input type="date" name="from" defaultValue={q.from} className={inputClass} />
        </Field>
        <Field label="利用日(まで)">
          <input type="date" name="to" defaultValue={q.to} className={inputClass} />
        </Field>
        <Field label="作成経路">
          <select name="source" defaultValue={q.source ?? ''} className={inputClass}>
            <option value="">すべて</option>
            {Object.entries(BOOKING_SOURCE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonClass.primary}>
            検索
          </button>
          <Link href="/admin/bookings" className={buttonClass.secondary}>
            クリア
          </Link>
        </div>
      </form>

      {error && <Notice tone="red">{error}</Notice>}
      {result && (
        <>
          <p className="mb-2 text-xs text-sub">
            該当 {result.total}件 / {result.page} / {result.pages}ページ
          </p>
          <Table
            head={[
              '予約番号',
              '日時',
              '店舗',
              '部屋',
              'お客様',
              '電話番号',
              '金額',
              '経路',
              '状態',
            ]}
            rows={result.rows.map((b) => [
              <TextLink key="c" href={`/admin/bookings/${b.bookingCode}`}>
                {b.bookingCode}
              </TextLink>,
              bookingWhen(b),
              b.storeCode,
              `${b.roomGroupName} ${b.roomName ?? '—'}`,
              b.customerName ?? '—',
              phoneLabel(b.phone),
              yen(b.total),
              BOOKING_SOURCE[b.source] ?? b.source,
              <StatusBadge key="s" status={b.status} />,
            ])}
          />
          <nav className="mt-3 flex gap-2 text-sm">
            {result.page > 1 && (
              <Link href={pageHref(result.page - 1)} className={buttonClass.secondary}>
                前へ
              </Link>
            )}
            {result.page < result.pages && (
              <Link href={pageHref(result.page + 1)} className={buttonClass.secondary}>
                次へ
              </Link>
            )}
          </nav>
        </>
      )}
    </>
  )
}

async function load(staff: Awaited<ReturnType<typeof requireStaff>>, q: Search) {
  const storeId = await selectedStoreId(staff, 'bookings.view')
  return withContainer((c) =>
    c.searchBookings(staff.access, storeId, {
      dateFrom: q.from,
      dateTo: q.to,
      status: q.status,
      code: q.code,
      name: q.name,
      phone: q.phone,
      source: q.source,
      page: Number(q.page ?? 1) || 1,
    }),
  )
}
