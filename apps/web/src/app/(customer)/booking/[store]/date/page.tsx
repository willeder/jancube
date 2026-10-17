import type { BookingCalendar, CalendarDayStatus } from '@jancube/application'
import Link from 'next/link'
import { BookingFlow } from '@/components/BookingFlow'
import { FunnelBeacon } from '@/components/FunnelBeacon'
import { ErrorPanel } from '@/components/StoreBar'
import { WEEKDAYS, weekdayIndex } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

const mark: Record<CalendarDayStatus, string> = {
  available: '○',
  few: '△',
  full: '✕',
  closed: '休',
  not_bookable: '',
}

/** C-02 日付選択 */
export default async function DateSelectPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { store } = await params
  const { month } = await searchParams

  let calendar: BookingCalendar
  try {
    calendar = await withContainer((c) => c.getBookingCalendar(store))
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }

  const months = [...new Set(calendar.days.map((d) => d.date.slice(0, 7)))]
  const firstMonth = calendar.firstBookable.slice(0, 7)
  const current =
    month && months.includes(month) ? month : (months.find((m) => m >= firstMonth) ?? months[0])
  const index = months.indexOf(current ?? '')
  const statusByDate = new Map(calendar.days.map((d) => [d.date, d.status]))
  const [year, mon] = (current ?? '').split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const leading = weekdayIndex(`${current}-01`)

  return (
    <BookingFlow step={2} storeName={calendar.store.name} backHref="/">
      <FunnelBeacon step="store_selected" store={store} />
      <h1 className="text-base font-bold">日付を選ぶ</h1>
      <p className="text-sm text-sub">
        受付期間は本日から{calendar.days.length - 1}日先まで。休業日は選択できません
      </p>

      <section className="booking-calendar booking-card">
        <div className="flex items-center justify-between">
          <MonthLink store={store} month={months[index - 1]} label="‹" />
          <span className="text-[15px] font-bold">
            {year}年{mon}月
          </span>
          <MonthLink store={store} month={months[index + 1]} label="›" />
        </div>

        <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[11px]">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={i === 0 ? 'text-alert' : i === 6 ? 'text-blue-600' : 'text-sub'}
            >
              {w}
            </div>
          ))}
          {Array.from({ length: leading }, (_, i) => (
            <div key={`pad-${i.toString()}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${current}-${String(i + 1).padStart(2, '0')}`
            const status = statusByDate.get(date)
            const bookable = status === 'available' || status === 'few'
            const body = (
              <>
                <div className="text-sm font-bold">{i + 1}</div>
                <div
                  className={
                    status === 'few' ? 'text-[9.5px] text-gold' : 'text-[9.5px] text-brand'
                  }
                >
                  {status ? mark[status] : ''}
                </div>
              </>
            )
            return bookable ? (
              <Link
                key={date}
                href={`/booking/${store}/slots?date=${date}`}
                aria-label={`${date} ${status === 'few' ? '残りわずか' : '空きあり'}`}
                className="flex min-h-11 flex-col items-center justify-center rounded-[10px] hover:bg-brand-pale focus-visible:outline-2 focus-visible:outline-brand"
              >
                {body}
              </Link>
            ) : (
              <div
                key={date}
                className="flex min-h-11 flex-col items-center justify-center rounded-[10px] text-sub/40"
              >
                {body}
              </div>
            )
          })}
        </div>

        <p className="mt-2 text-[11px] text-sub">
          ○=空きあり / △=残りわずか / ✕=満室 / 灰色=受付期間外・休業日
        </p>
      </section>
    </BookingFlow>
  )
}

function MonthLink({ store, month, label }: { store: string; month?: string; label: string }) {
  if (!month) return <span className="w-8 text-center text-line">{label}</span>
  return (
    <Link
      href={`/booking/${store}/date?month=${month}`}
      className="w-8 text-center font-bold text-brand"
    >
      {label}
    </Link>
  )
}
