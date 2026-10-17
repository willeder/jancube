import type { DayAvailability } from '@jancube/application'
import Link from 'next/link'
import { BookingFlow } from '@/components/BookingFlow'
import { FunnelBeacon } from '@/components/FunnelBeacon'
import { ErrorPanel } from '@/components/StoreBar'
import { WEEKDAYS, weekdayIndex } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { SlotPicker } from './SlotPicker'

export const dynamic = 'force-dynamic'

/** C-03 空き表・時間/部屋選択 */
export default async function SlotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { store } = await params
  const { date } = await searchParams
  const back = `/booking/${store}/date`
  if (!date) return <ErrorPanel message="日付を選んでください" backHref={back} />

  let day: DayAvailability
  let nearby: { date: string; bookable: boolean }[]
  try {
    ;[day, nearby] = await withContainer(async (c) => {
      const [availability, calendar] = await Promise.all([
        c.getDayAvailability(store, date),
        c.getBookingCalendar(store),
      ])
      const i = calendar.days.findIndex((d) => d.date === date)
      const around = calendar.days.slice(Math.max(0, i - 2), Math.max(0, i - 2) + 5)
      return [
        availability,
        around.map((d) => ({
          date: d.date,
          bookable: d.status === 'available' || d.status === 'few',
        })),
      ] as const
    })
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref={back} />
  }

  return (
    <BookingFlow step={3} storeName={day.store.name} backHref={back}>
      <FunnelBeacon step="slots_viewed" store={store} />
      <div className="flex flex-wrap gap-2">
        {nearby.map((d) =>
          d.bookable ? (
            <Link
              key={d.date}
              href={`/booking/${store}/slots?date=${d.date}`}
              className={`shrink-0 rounded-xl border-[1.5px] px-3 py-[7px] text-[13.5px] font-bold ${
                d.date === date ? 'border-brand bg-brand text-white' : 'border-line bg-white'
              }`}
            >
              {Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}{' '}
              {WEEKDAYS[weekdayIndex(d.date)]}
            </Link>
          ) : (
            <span
              key={d.date}
              className="shrink-0 rounded-xl bg-line/40 px-3 py-[7px] text-[13.5px] text-sub/60"
            >
              {Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}{' '}
              {WEEKDAYS[weekdayIndex(d.date)]}
            </span>
          ),
        )}
      </div>
      <h1 className="text-base font-bold">時間を選ぶ</h1>
      <p className="text-sm text-sub">① 開始の◯をタップ → ② 終了の◯をタップ（30分単位）</p>
      <SlotPicker day={day} />
    </BookingFlow>
  )
}
