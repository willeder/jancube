import Link from 'next/link'
import { Card, Notice, PageHeader } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { bookingWhen } from '@/lib/booking-time'
import { dateLabel, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'
import { ChangePicker } from './ChangePicker'

export const dynamic = 'force-dynamic'

/** Dates offered as chips (the store's booking horizon still applies when choosing). */
const DATE_CHIPS = 14

/**
 * C-14 予約変更 (F-BK-14, conditions provisional): the C-02/C-03 selection reused for a new date,
 * time or room in the same store, while cancellation is still free.
 */
export default async function ChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { code } = await params
  const { date: dateParam } = await searchParams
  const back = bookingPath(code)
  const memberId = await requireMemberPage(bookingPath(code, '/change'))

  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(code, memberId, dateParam)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref={back} />
  }
  const { detail, dates, date, day, dayError } = view
  const b = detail.booking

  return (
    <>
      <PageHeader backHref={back} title="予約の変更" />
      <div className="mx-auto max-w-md px-4 pt-3">
        <div className="rounded-xl bg-brand-dark py-3 text-center font-bold text-white">
          📍 {b.store.name}
        </div>
      </div>
      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        <p className="text-sm text-sub">日時・時間・お部屋を選び直します（同じ店舗内）</p>
        <Notice tone="warn">
          ⚠
          ご利用開始24時間前以降（キャンセル料が発生する期間）は、日程変更もできません。変更後の料金が高くなる変更は、この画面ではお受けできません
        </Notice>

        <Card>
          <p className="text-xs text-sub">変更前</p>
          <p className="mt-1 font-bold">
            {bookingWhen({ ...b, timezone: b.store.timezone })} / {b.roomGroupName} /{' '}
            {yen(b.price.total)}
          </p>
        </Card>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {dates.map((d) => (
            <Link
              key={d}
              href={`${bookingPath(code, '/change')}?date=${d}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                d === date ? 'border-brand bg-brand text-white' : 'border-line bg-white'
              }`}
            >
              {dateLabel(d)}
            </Link>
          ))}
        </div>

        {day ? (
          <ChangePicker
            bookingCode={b.bookingCode}
            day={day}
            currentTotal={b.price.total}
            requestKey={crypto.randomUUID()}
          />
        ) : (
          <Notice tone="alert">{dayError ?? 'この日はご予約いただけません'}</Notice>
        )}
        <p className="text-xs text-sub">
          変更できる期限・回数の条件は仮のものです。差額が安くなる場合は、お支払いに使われた決済方法へ返金されます（反映まで数日）
        </p>
      </main>
    </>
  )
}

function load(code: string, memberId: number, dateParam: string | undefined) {
  return withContainer(async (c) => {
    const detail = await c.getMyBookingDetail(code, memberId)
    const target = await c.getChangeableBooking(code, memberId)
    const calendar = await c.getBookingCalendar(target.storeCode)
    const dates = calendar.days
      .filter((d) => d.status !== 'closed' && d.status !== 'not_bookable')
      .map((d) => d.date)
      .slice(0, DATE_CHIPS)
    if (!dates.includes(target.businessDate) && target.businessDate >= calendar.firstBookable) {
      dates.unshift(target.businessDate)
    }
    const date =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : target.businessDate
    let day = null
    let dayError: string | null = null
    try {
      day = await c.getChangeAvailability(code, memberId, date)
    } catch (error) {
      dayError = toUserMessage(error)
    }
    return { detail, dates, date, day, dayError }
  })
}
