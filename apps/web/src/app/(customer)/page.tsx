import type { WeeklyHours } from '@jancube/domain'
import Link from 'next/link'
import { BookingFlow } from '@/components/BookingFlow'
import { hhmm } from '@/lib/format'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** C-01 店舗選択 */
export default async function StoreSelectPage() {
  const stores = await withContainer((c) => c.listStores())

  return (
    <BookingFlow step={1}>
      <h1>店舗を選ぶ</h1>
      <p className="text-sm text-sub">
        タップするとそのまま日時選択へ進みます。同じ会員IDで全店舗ご利用いただけます
      </p>
      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.code} className="booking-store-card booking-card">
            <Link
              href={`/booking/${s.code}/date`}
              className="booking-store-link block focus-visible:outline-2 focus-visible:outline-brand"
            >
              <div className="flex items-center justify-between gap-2 text-[14px] font-bold">
                <span>
                  {s.code} {s.name}
                </span>
                {hoursLabel(s.regularHours) && (
                  <span
                    className="shrink-0 rounded-full bg-brand-pale px-2 py-[3px] text-[11px] text-brand-dark"
                    title="通常の営業時間。営業日・特別営業時間は日付選択でご確認ください"
                  >
                    {hoursLabel(s.regularHours)}
                  </span>
                )}
              </div>
              {s.accessText && <p className="mt-1.5 text-xs text-sub">{s.accessText}</p>}
            </Link>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-sub">{s.address}</p>
              <a
                href={
                  s.mapUrl ??
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="booking-map"
              >
                🗺 地図を見る<span className="sr-only">（{s.name}・別タブで開く）</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
    </BookingFlow>
  )
}

/** Only advertise hours backed by store data; special dates remain governed by the calendar. */
function hoursLabel(hours: readonly WeeklyHours[] | null): string | null {
  if (!hours) return null
  const windows = [
    ...new Set(
      hours
        .filter((day) => !day.isClosed)
        .map((day) => `${hhmm(day.opensMinute)}–${hhmm(day.closesMinute)}`),
    ),
  ]
  return windows.length === 1 ? (windows[0] ?? null) : windows.length > 1 ? '曜日別営業' : null
}
