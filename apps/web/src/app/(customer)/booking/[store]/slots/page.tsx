import type { DayAvailability } from '@jancube/application'
import Link from 'next/link'
import { FunnelBeacon } from '@/components/FunnelBeacon'
import { ErrorPanel, StoreBar } from '@/components/StoreBar'
import { dateLabel } from '@/lib/format'
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
      const around = calendar.days.slice(Math.max(0, i - 2), Math.max(0, i - 2) + 7)
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
    <>
      <StoreBar storeName={day.store.name} backHref={back} />
      <main className="mx-auto max-w-md px-4 py-5">
        <FunnelBeacon step="slots_viewed" store={store} />
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {nearby.map((d) =>
            d.bookable ? (
              <Link
                key={d.date}
                href={`/booking/${store}/slots?date=${d.date}`}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                  d.date === date ? 'border-brand bg-brand text-white' : 'border-line bg-white'
                }`}
              >
                {dateLabel(d.date)}
              </Link>
            ) : (
              <span
                key={d.date}
                className="shrink-0 rounded-full bg-line/40 px-3 py-1 text-xs text-sub/60"
              >
                {dateLabel(d.date)}
              </span>
            ),
          )}
        </div>
        <h1 className="mt-3 text-lg font-bold">時間を選ぶ</h1>
        <p className="mt-1 text-sm text-sub">① 開始の◯をタップ → ② 終了の◯をタップ（30分単位）</p>
        <SlotPicker day={day} />
      </main>
    </>
  )
}
